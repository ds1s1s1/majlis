// Virtual controllers through the ViGEmBus driver, one per player slot.
// Talks to the bus directly (a few IOCTLs) so the DualShock 4 gets its full 63-byte report:
// gyro, accelerometer and touchpad, not just sticks and buttons. Rumble comes back as events.
use crate::proto;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use windows::core::{GUID, PCWSTR};
use windows::Win32::Devices::DeviceAndDriverInstallation::*;
use windows::Win32::Foundation::*;
use windows::Win32::Storage::FileSystem::*;
use windows::Win32::System::IO::{DeviceIoControl, GetOverlappedResult, OVERLAPPED};
use windows::Win32::System::Threading::CreateEventW;

const BUS: GUID = GUID::from_u128(0x96E42B22_F5E9_42F8_B043_ED0F932F014F);
const PLUGIN: u32 = 0x2AA004;
const UNPLUG: u32 = 0x2AA008;
const CHECK_VERSION: u32 = 0x2AA00C;
const WAIT_READY: u32 = 0x2AA010;
const XUSB_NOTIFY: u32 = 0x2AE804;
const XUSB_SUBMIT: u32 = 0x2AA808;
const DS4_SUBMIT: u32 = 0x2AA80C;
const DS4_NOTIFY: u32 = 0x2AE810;

#[derive(Clone, Copy)]
struct Bus(HANDLE);
unsafe impl Send for Bus {}
unsafe impl Sync for Bus {}

impl Bus {
    fn open() -> Result<Bus, String> {
        unsafe {
            let set = SetupDiGetClassDevsW(Some(&BUS), PCWSTR::null(), None, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE).map_err(|_| "ViGEmBus is not installed".to_string())?;
            let mut i = 0;
            let mut found = None;
            loop {
                let mut ifd = SP_DEVICE_INTERFACE_DATA { cbSize: std::mem::size_of::<SP_DEVICE_INTERFACE_DATA>() as u32, ..Default::default() };
                if SetupDiEnumDeviceInterfaces(set, None, &BUS, i, &mut ifd).is_err() { break; }
                i += 1;
                let mut buf = vec![0u32; 0x300];
                let det = buf.as_mut_ptr() as *mut SP_DEVICE_INTERFACE_DETAIL_DATA_W;
                (*det).cbSize = std::mem::size_of::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>() as u32;
                if SetupDiGetDeviceInterfaceDetailW(set, &ifd, Some(det), (buf.len() * 4) as u32, None, None).is_err() { continue; }
                let path = PCWSTR(std::ptr::addr_of!((*det).DevicePath) as *const u16);
                if let Ok(h) = CreateFileW(path, (GENERIC_READ | GENERIC_WRITE).0, FILE_SHARE_READ | FILE_SHARE_WRITE, None, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_NO_BUFFERING | FILE_FLAG_WRITE_THROUGH | FILE_FLAG_OVERLAPPED, None) {
                    let b = Bus(h);
                    let mut v = [8u32, 0x0001];
                    if b.ioctl(CHECK_VERSION, v.as_mut_ptr() as _, 8, false).is_ok() { found = Some(b); break; }
                    let _ = CloseHandle(h);
                }
            }
            let _ = SetupDiDestroyDeviceInfoList(set);
            found.ok_or_else(|| "ViGEmBus is not installed".to_string())
        }
    }

    // one blocking IOCTL (overlapped handle, waited for)
    fn ioctl(&self, code: u32, buf: *mut std::ffi::c_void, len: u32, out: bool) -> Result<(), String> {
        unsafe {
            let ev = CreateEventW(None, true, false, None).map_err(|e| e.to_string())?;
            let mut ov = OVERLAPPED { hEvent: ev, ..Default::default() };
            let mut n = 0u32;
            let _ = DeviceIoControl(self.0, code, Some(buf), len, if out { Some(buf) } else { None }, if out { len } else { 0 }, Some(&mut n), Some(&mut ov));
            let r = GetOverlappedResult(self.0, &ov, &mut n, true);
            let _ = CloseHandle(ev);
            r.map_err(|e| format!("{e}"))
        }
    }
}

enum Kind { X360, Ds4 }
struct Pad { serial: u32, kind: Kind, ds4: [u8; 63], clock: u16 }

pub struct Pads {
    bus: Option<Bus>,
    pub error: Option<String>,
    pads: HashMap<i64, Pad>,
    alive: Arc<Mutex<HashMap<u32, bool>>>,
    next_serial: u32,
    ds4_ex_len: Option<u32>,
}

impl Pads {
    pub fn new() -> Pads {
        Pads { bus: None, error: None, pads: HashMap::new(), alive: Arc::new(Mutex::new(HashMap::new())), next_serial: 1, ds4_ex_len: None }
    }

    pub fn available(&mut self) -> bool {
        if self.bus.is_some() { return true; }
        match Bus::open() { Ok(b) => { self.bus = Some(b); self.error = None; true } Err(e) => { self.error = Some(e); false } }
    }

    pub fn add(&mut self, slot: i64, kind: &str) {
        if !self.available() { proto::event("pad_added", json!({ "slot": slot, "ok": false, "error": self.error })); return; }
        self.remove(slot);
        let bus = self.bus.unwrap();
        let serial = self.next_serial; self.next_serial += 1;
        let ds4 = kind == "ds4";
        // [Size][SerialNo][TargetType][VendorId u16][ProductId u16]
        let mut plug = [0u8; 16];
        plug[0..4].copy_from_slice(&16u32.to_le_bytes());
        plug[4..8].copy_from_slice(&serial.to_le_bytes());
        plug[8..12].copy_from_slice(&(if ds4 { 2i32 } else { 0i32 }).to_le_bytes());
        let (vid, pid): (u16, u16) = if ds4 { (0x054C, 0x05C4) } else { (0x045E, 0x028E) };
        plug[12..14].copy_from_slice(&vid.to_le_bytes());
        plug[14..16].copy_from_slice(&pid.to_le_bytes());
        if let Err(e) = bus.ioctl(PLUGIN, plug.as_mut_ptr() as _, 16, false) { proto::event("pad_added", json!({ "slot": slot, "ok": false, "error": e })); return; }
        let mut wr = [8u32, serial];
        let _ = bus.ioctl(WAIT_READY, wr.as_mut_ptr() as _, 8, false);
        let mut st = [0u8; 63];
        st[0] = 0x80; st[1] = 0x80; st[2] = 0x80; st[3] = 0x80; st[4] = 0x08;
        self.pads.insert(slot, Pad { serial, kind: if ds4 { Kind::Ds4 } else { Kind::X360 }, ds4: st, clock: 0 });
        self.alive.lock().unwrap().insert(serial, true);
        // rumble from the game comes back through a notification the bus completes
        let alive = self.alive.clone();
        std::thread::spawn(move || loop {
            if !*alive.lock().unwrap().get(&serial).unwrap_or(&false) { break; }
            let (code, mut buf): (u32, [u8; 16]) = (if ds4 { DS4_NOTIFY } else { XUSB_NOTIFY }, [0; 16]);
            let size: u32 = if ds4 { 16 } else { 12 };
            buf[0..4].copy_from_slice(&size.to_le_bytes());
            buf[4..8].copy_from_slice(&serial.to_le_bytes());
            if bus.ioctl(code, buf.as_mut_ptr() as _, size, true).is_err() { break; }
            if !*alive.lock().unwrap().get(&serial).unwrap_or(&false) { break; }
            proto::event("rumble", json!({ "slot": slot, "large": buf[8], "small": buf[9] }));
        });
        proto::event("pad_added", json!({ "slot": slot, "ok": true, "type": kind }));
    }

    pub fn remove(&mut self, slot: i64) {
        if let Some(p) = self.pads.remove(&slot) {
            self.alive.lock().unwrap().insert(p.serial, false);
            if let Some(b) = self.bus { let mut u = [8u32, p.serial]; let _ = b.ioctl(UNPLUG, u.as_mut_ptr() as _, 8, false); }
        }
    }

    pub fn remove_all(&mut self) { for s in self.pads.keys().copied().collect::<Vec<_>>() { self.remove(s); } }

    // W3C "standard" gamepad button bits -> XUSB buttons
    pub fn state(&mut self, slot: i64, c: &Value) {
        let Some(bus) = self.bus else { return };
        let Some(p) = self.pads.get_mut(&slot) else { return };
        let b = c["b"].as_u64().unwrap_or(0) as u32;
        let ax = |k: &str| c[k].as_i64().unwrap_or(0).clamp(-32768, 32767) as i16;
        let (lx, ly, rx, ry) = (ax("lx"), ax("ly"), ax("rx"), ax("ry"));
        let lt = c["lt"].as_u64().unwrap_or(0).min(255) as u8;
        let rt = c["rt"].as_u64().unwrap_or(0).min(255) as u8;
        let bit = |i: u32| (b >> i) & 1 != 0;
        match p.kind {
            Kind::X360 => {
                const MAP: [u16; 17] = [0x1000, 0x2000, 0x4000, 0x8000, 0x0100, 0x0200, 0, 0, 0x0020, 0x0010, 0x0040, 0x0080, 0x0001, 0x0002, 0x0004, 0x0008, 0x0400];
                let mut w = 0u16;
                for (i, m) in MAP.iter().enumerate() { if bit(i as u32) { w |= m; } }
                let neg = |v: i16| (-(v as i32)).clamp(-32768, 32767) as i16;
                // [Size][Serial][wButtons][LT][RT][LX][LY][RX][RY]
                let mut r = [0u8; 20];
                r[0..4].copy_from_slice(&20u32.to_le_bytes());
                r[4..8].copy_from_slice(&p.serial.to_le_bytes());
                r[8..10].copy_from_slice(&w.to_le_bytes());
                r[10] = lt; r[11] = rt;
                r[12..14].copy_from_slice(&lx.to_le_bytes());
                r[14..16].copy_from_slice(&neg(ly).to_le_bytes());
                r[16..18].copy_from_slice(&rx.to_le_bytes());
                r[18..20].copy_from_slice(&neg(ry).to_le_bytes());
                let _ = bus.ioctl(XUSB_SUBMIT, r.as_mut_ptr() as _, 20, false);
            }
            Kind::Ds4 => {
                let a = |v: i16| (((v as i32) + 32768) >> 8).clamp(0, 255) as u8;
                let st = &mut p.ds4;
                st[0] = a(lx); st[1] = a(ly); st[2] = a(rx); st[3] = a(ry);
                let (u, d, l, r) = (bit(12), bit(13), bit(14), bit(15));
                let dpad: u16 = match (u, r, d, l) {
                    (true, true, _, _) => 1, (_, true, true, _) => 3, (_, _, true, true) => 5, (true, _, _, true) => 7,
                    (true, _, _, _) => 0, (_, true, _, _) => 2, (_, _, true, _) => 4, (_, _, _, true) => 6, _ => 8,
                };
                let mut w = dpad;
                if bit(2) { w |= 1 << 4; } if bit(0) { w |= 1 << 5; } if bit(1) { w |= 1 << 6; } if bit(3) { w |= 1 << 7; }
                if bit(4) { w |= 1 << 8; } if bit(5) { w |= 1 << 9; } if lt > 0 { w |= 1 << 10; } if rt > 0 { w |= 1 << 11; }
                if bit(8) { w |= 1 << 12; } if bit(9) { w |= 1 << 13; } if bit(10) { w |= 1 << 14; } if bit(11) { w |= 1 << 15; }
                st[4] = (w & 0xff) as u8; st[5] = (w >> 8) as u8;
                st[6] = (bit(16) as u8) | ((bit(17) as u8) << 1);
                st[7] = lt; st[8] = rt;
                let serial = p.serial;
                self.submit_ds4(bus, slot, serial);
            }
        }
    }

    // gyro, accel, up to two touch points (DualSense / DS4 on the guest side)
    pub fn motion(&mut self, slot: i64, c: &Value) {
        let Some(bus) = self.bus else { return };
        let Some(p) = self.pads.get_mut(&slot) else { return };
        if !matches!(p.kind, Kind::Ds4) { return; }
        let st = &mut p.ds4;
        let put = |st: &mut [u8; 63], o: usize, v: i64| st[o..o + 2].copy_from_slice(&(v.clamp(-32768, 32767) as i16).to_le_bytes());
        if let Some(g) = c["g"].as_array() { for i in 0..3 { put(st, 12 + i * 2, g.get(i).and_then(|v| v.as_i64()).unwrap_or(0)); } }
        if let Some(a) = c["a"].as_array() { for i in 0..3 { put(st, 18 + i * 2, a.get(i).and_then(|v| v.as_i64()).unwrap_or(0)); } }
        st[29] = 0x1b; // "charging, full": no battery nags
        if let Some(t) = c["t"].as_array() {
            st[32] = 1; st[33] = st[33].wrapping_add(1);
            for f in 0..2usize {
                let o = 34 + f * 4;
                let pt = t.get(f).and_then(|v| v.as_array());
                let on = pt.map(|x| x.first().and_then(|v| v.as_i64()).unwrap_or(0) != 0).unwrap_or(false);
                let x = if on { pt.unwrap().get(1).and_then(|v| v.as_i64()).unwrap_or(0) } else { 0 } as u32;
                let y = if on { pt.unwrap().get(2).and_then(|v| v.as_i64()).unwrap_or(0) } else { 0 } as u32;
                st[o] = (if on { 0 } else { 0x80 }) | (f as u8 & 0x7f);
                st[o + 1] = (x & 0xff) as u8; st[o + 2] = (((x >> 8) & 0xf) | ((y & 0xf) << 4)) as u8; st[o + 3] = (y >> 4) as u8;
            }
        }
        let serial = p.serial;
        self.submit_ds4(bus, slot, serial);
    }

    fn submit_ds4(&mut self, bus: Bus, slot: i64, serial: u32) {
        let Some(p) = self.pads.get_mut(&slot) else { return };
        p.clock = p.clock.wrapping_add(188);
        p.ds4[9..11].copy_from_slice(&p.clock.to_le_bytes());
        // full report: [Size][Serial][63 bytes]. The driver takes it by exact size (72 with
        // the usual padding; try 71 once if that's refused).
        let mut buf = [0u8; 72];
        buf[4..8].copy_from_slice(&serial.to_le_bytes());
        buf[8..71].copy_from_slice(&p.ds4);
        for len in self.ds4_ex_len.map(|l| vec![l]).unwrap_or(vec![72, 71]) {
            buf[0..4].copy_from_slice(&len.to_le_bytes());
            if bus.ioctl(DS4_SUBMIT, buf.as_mut_ptr() as _, len, false).is_ok() { self.ds4_ex_len = Some(len); return; }
        }
        // old driver: the short report (sticks, buttons, triggers)
        let mut s = [0u8; 20];
        s[0..4].copy_from_slice(&20u32.to_le_bytes());
        s[4..8].copy_from_slice(&serial.to_le_bytes());
        s[8..17].copy_from_slice(&p.ds4[0..9]);
        let _ = bus.ioctl(DS4_SUBMIT, s.as_mut_ptr() as _, 20, false);
    }
}
