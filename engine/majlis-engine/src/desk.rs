// The desktop around the stream: windows to pick from, displays, app icons, the mouse
// pointer (the viewer draws it locally, so it moves without waiting for video), push-to-talk,
// and GPU scheduling priority.
use crate::proto;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Mutex;
use windows::core::{Interface, BOOL, PCWSTR, PWSTR};
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Dxgi::*;
use windows::Win32::Graphics::Dxgi::Common::DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows::Win32::System::Threading::*;
use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
use windows::Win32::UI::Shell::SHDefExtractIconW;
use windows::Win32::UI::WindowsAndMessaging::*;

// ---------------------------------------------------------------- icons -> PNG (base64)
fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity((data.len() + 2) / 3 * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        s.push(T[(n >> 18) as usize & 63] as char);
        s.push(T[(n >> 12) as usize & 63] as char);
        s.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        s.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    s
}

fn png(w: u32, h: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut e = png::Encoder::new(&mut out, w, h);
        e.set_color(png::ColorType::Rgba);
        e.set_depth(png::BitDepth::Eight);
        let mut w = e.write_header().ok()?;
        w.write_image_data(rgba).ok()?;
    }
    Some(out)
}

fn bitmap_bits(bmp: HBITMAP) -> Option<(u32, u32, Vec<u8>)> {
    unsafe {
        let mut bm = BITMAP::default();
        if GetObjectW(bmp.into(), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as _)) == 0 { return None; }
        let (w, h) = (bm.bmWidth as u32, bm.bmHeight as u32);
        let mut bi = BITMAPINFO::default();
        bi.bmiHeader = BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: w as i32, biHeight: -(h as i32), biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() };
        let mut px = vec![0u8; (w * h * 4) as usize];
        let dc = GetDC(None);
        let n = GetDIBits(dc, bmp, 0, h, Some(px.as_mut_ptr() as _), &mut bi, DIB_RGB_COLORS);
        ReleaseDC(None, dc);
        if n == 0 { return None; }
        Some((w, h, px))
    }
}

// HICON -> (png, hotspot x, y, w, h). Handles colour cursors with or without alpha and the
// old black-and-white ones (AND/XOR masks).
fn icon_png(icon: HICON) -> Option<(Vec<u8>, u32, u32, u32, u32)> {
    unsafe {
        let mut ii = ICONINFO::default();
        GetIconInfo(icon, &mut ii).ok()?;
        let res = (|| {
            let (mw, mh, mask) = bitmap_bits(ii.hbmMask)?;
            let mut rgba;
            let (w, h);
            if !ii.hbmColor.is_invalid() {
                let (cw, ch, col) = bitmap_bits(ii.hbmColor)?;
                w = cw; h = ch;
                rgba = vec![0u8; (w * h * 4) as usize];
                let has_alpha = col.chunks(4).any(|p| p[3] != 0);
                for i in 0..(w * h) as usize {
                    let (b, g, r, a) = (col[i * 4], col[i * 4 + 1], col[i * 4 + 2], col[i * 4 + 3]);
                    let a = if has_alpha { a } else if mask[i * 4] == 0 { 255 } else { 0 };
                    rgba[i * 4..i * 4 + 4].copy_from_slice(&[r, g, b, a]);
                }
            } else {
                // monochrome: top half AND mask, bottom half XOR mask
                w = mw; h = mh / 2;
                rgba = vec![0u8; (w * h * 4) as usize];
                for i in 0..(w * h) as usize {
                    let and = mask[i * 4] != 0;
                    let xor = mask[(i + (w * h) as usize) * 4] != 0;
                    let px = match (and, xor) { (false, false) => [0, 0, 0, 255], (false, true) => [255, 255, 255, 255], (true, false) => [0, 0, 0, 0], (true, true) => [0, 0, 0, 200] };
                    rgba[i * 4..i * 4 + 4].copy_from_slice(&px);
                }
            }
            Some((png(w, h, &rgba)?, ii.xHotspot, ii.yHotspot, w, h))
        })();
        if !ii.hbmMask.is_invalid() { let _ = DeleteObject(ii.hbmMask.into()); }
        if !ii.hbmColor.is_invalid() { let _ = DeleteObject(ii.hbmColor.into()); }
        res
    }
}

pub fn icon(path: &str) -> Option<String> {
    let w: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
    let mut large = HICON::default();
    unsafe {
        if SHDefExtractIconW(PCWSTR(w.as_ptr()), 0, 0, Some(&mut large), None, 64).is_err() || large.is_invalid() { return None; }
        let r = icon_png(large).map(|(p, ..)| b64(&p));
        let _ = DestroyIcon(large);
        r
    }
}

// ---------------------------------------------------------------- windows & displays
fn process_path(pid: u32) -> String {
    unsafe {
        let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return String::new() };
        let mut buf = [0u16; 1024];
        let mut n = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut n).is_ok();
        let _ = CloseHandle(h);
        if ok { String::from_utf16_lossy(&buf[..n as usize]) } else { String::new() }
    }
}

fn frame_rect(h: HWND) -> RECT {
    let mut r = RECT::default();
    unsafe { let _ = DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut _ as _, 16); }
    r
}

pub fn windows_list() -> Value {
    let mut list: Vec<Value> = vec![];
    unsafe extern "system" fn cb(h: HWND, l: LPARAM) -> BOOL {
        let list = &mut *(l.0 as *mut Vec<Value>);
        unsafe {
            if !IsWindowVisible(h).as_bool() || !GetWindow(h, GW_OWNER).unwrap_or_default().is_invalid() { return TRUE; }
            if (GetWindowLongW(h, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0) != 0 { return TRUE; }
            let mut cloaked = 0u32;
            let _ = DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut _ as _, 4);
            if cloaked != 0 { return TRUE; }
            let len = GetWindowTextLengthW(h);
            if len == 0 { return TRUE; }
            let mut t = vec![0u16; len as usize + 1];
            let n = GetWindowTextW(h, &mut t);
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, Some(&mut pid));
            if pid == std::process::id() { return TRUE; }
            let path = process_path(pid);
            let exe = std::path::Path::new(&path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            if ["TextInputHost", "ApplicationFrameHost", "SystemSettings", "ShellExperienceHost"].contains(&exe.as_str()) { return TRUE; }
            let r = frame_rect(h);
            list.push(json!({ "hwnd": h.0 as i64, "title": String::from_utf16_lossy(&t[..n as usize]), "exe": exe, "path": path, "pid": pid, "x": r.left, "y": r.top, "w": r.right - r.left, "h": r.bottom - r.top }));
        }
        TRUE
    }
    unsafe { let _ = EnumWindows(Some(cb), LPARAM(&mut list as *mut _ as isize)); }
    Value::Array(list)
}

// same order the encoders use: outputs of the first adapter
pub fn displays() -> Value {
    let mut list = vec![];
    unsafe {
        let Ok(f) = CreateDXGIFactory1::<IDXGIFactory1>() else { return Value::Array(list) };
        let Ok(a) = f.EnumAdapters1(0) else { return Value::Array(list) };
        let aname = a.GetDesc1().map(|d| String::from_utf16_lossy(&d.Description).trim_end_matches('\0').to_string()).unwrap_or_default();
        let mut i = 0;
        while let Ok(o) = a.EnumOutputs(i) {
            if let Ok(d) = o.GetDesc() {
                let name = String::from_utf16_lossy(&d.DeviceName).trim_end_matches('\0').to_string();
                let hdr = o.cast::<IDXGIOutput6>().ok().and_then(|o6| o6.GetDesc1().ok()).map(|d1| d1.ColorSpace == DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020).unwrap_or(false);
                let mut dm = DEVMODEW { dmSize: std::mem::size_of::<DEVMODEW>() as u16, ..Default::default() };
                let _ = EnumDisplaySettingsW(PCWSTR(d.DeviceName.as_ptr()), ENUM_CURRENT_SETTINGS, &mut dm);
                let r = d.DesktopCoordinates;
                list.push(json!({ "index": i, "name": name, "x": r.left, "y": r.top, "w": r.right - r.left, "h": r.bottom - r.top, "hz": dm.dmDisplayFrequency, "primary": r.left == 0 && r.top == 0, "hdr": hdr, "adapter": aname }));
            }
            i += 1;
        }
    }
    Value::Array(list)
}

pub fn focus(hwnd: i64) {
    let h = HWND(hwnd as _);
    unsafe { if IsIconic(h).as_bool() { let _ = ShowWindow(h, SW_RESTORE); } let _ = SetForegroundWindow(h); }
}

// The film window (mpv's own; Chromium paints over anything drawn into its windows) made part
// of the app: owned by `owner` (stays above it, minimises with it, no taskbar button) and put at
// x,y,w,h in physical pixels, or hidden.
// `top`: also raise it (above its owner chain's other windows: the controls over the film)
pub fn place(hwnd: i64, owner: i64, x: i32, y: i32, w: i32, h: i32, show: bool, top: bool) {
    let hw = HWND(hwnd as _);
    unsafe {
        if !IsWindow(Some(hw)).as_bool() { return; }
        if owner != 0 {
            SetWindowLongPtrW(hw, GWLP_HWNDPARENT, owner as isize);
            let ex = GetWindowLongPtrW(hw, GWL_EXSTYLE);
            SetWindowLongPtrW(hw, GWL_EXSTYLE, (ex | WS_EX_TOOLWINDOW.0 as isize) & !(WS_EX_APPWINDOW.0 as isize));
        }
        let flags = SWP_NOACTIVATE | SWP_FRAMECHANGED | if show { SWP_SHOWWINDOW } else { SWP_HIDEWINDOW } | if top { SET_WINDOW_POS_FLAGS(0) } else { SWP_NOZORDER };
        // physical pixels as given: this thread is DPI-unaware, and Windows would scale them
        // again for mpv's (DPI-aware) window: on a 150% screen it landed offset and 1.5x too big
        let was = windows::Win32::UI::HiDpi::SetThreadDpiAwarenessContext(windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let _ = SetWindowPos(hw, if top { Some(HWND_TOP) } else { None }, x, y, w, h, flags);
        windows::Win32::UI::HiDpi::SetThreadDpiAwarenessContext(was);
    }
}

// before ffmpeg captures a window itself: still there, visible, not minimised
pub fn winprep(hwnd: i64) -> Value {
    let h = HWND(hwnd as _);
    unsafe {
        if !IsWindow(Some(h)).as_bool() || !IsWindowVisible(h).as_bool() { return json!({ "ok": false, "msg": "window is closed or hidden" }); }
        if IsIconic(h).as_bool() { let _ = ShowWindow(h, SW_RESTORE); std::thread::sleep(std::time::Duration::from_millis(300)); }
    }
    let r = frame_rect(h);
    let (w, hh) = (r.right - r.left, r.bottom - r.top);
    if w < 64 || hh < 64 { return json!({ "ok": false, "msg": "window too small" }); }
    json!({ "ok": true, "x": r.left, "y": r.top, "w": w, "h": hh })
}

// ---------------------------------------------------------------- GPU priority (what Sunshine does)
pub fn gpu_priority(pid: u32) -> bool {
    type F = unsafe extern "system" fn(HANDLE, i32) -> i32;
    unsafe {
        let Ok(lib) = LoadLibraryW(windows::core::w!("gdi32.dll")) else { return false };
        let Some(p) = GetProcAddress(lib, windows::core::s!("D3DKMTSetProcessSchedulingPriorityClass")) else { return false };
        let f: F = std::mem::transmute(p);
        let Ok(h) = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_INFORMATION, false, pid) else { return false };
        // realtime needs admin; high works for everyone
        let ok = f(h, 5) == 0 || f(h, 4) == 0;
        let _ = CloseHandle(h);
        ok
    }
}

// ---------------------------------------------------------------- push-to-talk (global)
static PTT_KEY: AtomicI32 = AtomicI32::new(0);
static PTT_RUN: AtomicBool = AtomicBool::new(false);

pub fn ptt(vk: i32) {
    PTT_KEY.store(vk, Ordering::Relaxed);
    if vk == 0 || PTT_RUN.swap(true, Ordering::Relaxed) { return; }
    std::thread::spawn(|| {
        let mut last = false;
        loop {
            let k = PTT_KEY.load(Ordering::Relaxed);
            let down = k != 0 && (unsafe { GetAsyncKeyState(k) } as u16 & 0x8000) != 0;
            if down != last { last = down; proto::event("ptt", json!({ "down": down })); }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    });
}

// ---------------------------------------------------------------- mouse pointer
static CUR_RUN: AtomicBool = AtomicBool::new(false);
pub static CUR_RECT: Mutex<(i32, i32, i32, i32)> = Mutex::new((0, 0, 1920, 1080));

// Polled every 4 ms (250 Hz): sooner than the desktop duplication would report it (that only
// comes with a new frame), and it works the same for window capture.
pub fn cursor(on: bool) {
    if !on { CUR_RUN.store(false, Ordering::Relaxed); return; }
    if CUR_RUN.swap(true, Ordering::Relaxed) { return; }
    std::thread::spawn(|| {
        let mut shapes: HashMap<isize, i32> = HashMap::new();
        let (mut lx, mut ly, mut lv, mut lh) = (-1f32, -1f32, false, 0isize);
        while CUR_RUN.load(Ordering::Relaxed) {
            let mut ci = CURSORINFO { cbSize: std::mem::size_of::<CURSORINFO>() as u32, ..Default::default() };
            if unsafe { GetCursorInfo(&mut ci) }.is_ok() {
                let vis = ci.flags.0 & 1 != 0;
                let (rx, ry, rw, rh) = *CUR_RECT.lock().unwrap();
                let x = (ci.ptScreenPos.x - rx) as f32 / rw.max(1) as f32;
                let y = (ci.ptScreenPos.y - ry) as f32 / rh.max(1) as f32;
                let hc = ci.hCursor.0 as isize;
                if vis && hc != lh {
                    if !shapes.contains_key(&hc) {
                        let id = shapes.len() as i32 + 1;
                        shapes.insert(hc, id);
                        unsafe {
                            if let Ok(copy) = CopyIcon(HICON(ci.hCursor.0)) {
                                if let Some((p, hx, hy, w, h)) = icon_png(copy) {
                                    proto::event("cursor_shape", json!({ "id": id, "png": b64(&p), "hx": hx, "hy": hy, "w": w, "h": h }));
                                }
                                let _ = DestroyIcon(copy);
                            }
                        }
                    }
                    lh = hc;
                }
                if x != lx || y != ly || vis != lv {
                    let mut pkt = [0u8; 13];
                    pkt[0..4].copy_from_slice(&x.to_le_bytes());
                    pkt[4..8].copy_from_slice(&y.to_le_bytes());
                    pkt[8] = vis as u8;
                    pkt[9..13].copy_from_slice(&shapes.get(&lh).copied().unwrap_or(0).to_le_bytes());
                    proto::raw(3, &pkt);
                    lx = x; ly = y; lv = vis;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(4));
        }
    });
}

// ---------------------------------------------------------------- foreground window watch (privacy curtain)
static FG_RUN: AtomicBool = AtomicBool::new(false);
static FG_TARGET: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

pub fn watch_fg(hwnd: i64) {
    if hwnd == 0 {
        FG_TARGET.store(0, Ordering::Relaxed);
        FG_RUN.store(false, Ordering::Relaxed);
        return;
    }
    FG_TARGET.store(hwnd as isize, Ordering::Relaxed);
    if FG_RUN.swap(true, Ordering::Relaxed) {
        return;
    }
    std::thread::spawn(|| {
        let mut last_target: isize = 0;
        let mut last_active: Option<bool> = None;
        while FG_RUN.load(Ordering::Relaxed) {
            let target = FG_TARGET.load(Ordering::Relaxed);
            if target == 0 { break; }
            if target != last_target {
                last_target = target;
                last_active = None;
            }
            let fg = unsafe { GetForegroundWindow() };
            let h = HWND(target as *mut _);
            let iconic = unsafe { IsIconic(h) }.as_bool();
            let active = fg.0 == h.0 && !iconic;
            if last_active != Some(active) {
                last_active = Some(active);
                proto::event("fg", json!({ "hwnd": target as i64, "active": active }));
            }
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
        FG_RUN.store(false, Ordering::Relaxed);
    });
}
