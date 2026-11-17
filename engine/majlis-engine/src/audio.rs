// Game audio: WASAPI loopback -> 48 kHz stereo -> native libopus, 10 ms packets.
//
// Process loopback (Windows 10 2004+) picks which sound goes out:
//   exclude = <pid>: everything except that process tree. The app passes its own, so the
//                    friends' voices and Majlis' own sounds never echo back to them.
//   include = <pid>: only that process tree ("game audio only" when sharing one window).
// Older Windows: the whole default output, as before.
// The last N seconds are also kept as PCM so instant replay can save the sound with the clip.
use crate::proto;
use audiopus_sys as op;
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use windows::core::{implement, Interface, HRESULT};
use windows::Win32::Foundation::*;
use windows::Win32::Media::Audio::*;
use windows::Win32::System::Com::StructuredStorage::*;
use windows::Win32::System::Com::*;
use windows::Win32::System::Threading::*;
use windows::Win32::System::Variant::VT_BLOB;

const RATE: usize = 48000;
const FRAME: usize = 480; // 10 ms

struct Ring { pcm: Vec<i16>, pos: usize, full: bool }

pub struct Audio {
    run: Arc<AtomicBool>,
    gen: Arc<AtomicU64>,
    ring: Arc<Mutex<Ring>>,
}

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct Done(HANDLE);
impl IActivateAudioInterfaceCompletionHandler_Impl for Done_Impl {
    fn ActivateCompleted(&self, _op: windows::core::Ref<'_, IActivateAudioInterfaceAsyncOperation>) -> windows::core::Result<()> {
        unsafe { let _ = SetEvent(self.0); }
        Ok(())
    }
}

fn process_client(pid: u32, include: bool) -> windows::core::Result<IAudioClient> {
    unsafe {
        let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
            ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                    TargetProcessId: pid,
                    ProcessLoopbackMode: if include { PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE } else { PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE },
                },
            },
        };
        let mut pv = PROPVARIANT::default();
        {
            let inner = &mut *pv.Anonymous.Anonymous;
            inner.vt = VT_BLOB;
            inner.Anonymous.blob = BLOB { cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32, pBlobData: &mut params as *mut _ as *mut u8 };
        }
        let ev = CreateEventW(None, true, false, None)?;
        let handler: IActivateAudioInterfaceCompletionHandler = Done(ev).into();
        let op = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, &IAudioClient::IID, Some(&pv), &handler)?;
        WaitForSingleObject(ev, 5000);
        let _ = CloseHandle(ev);
        let mut hr = HRESULT(0);
        let mut unk = None;
        op.GetActivateResult(&mut hr, &mut unk)?;
        // the blob points at our stack struct: don't let PROPVARIANT's drop free it
        std::mem::forget(pv);
        hr.ok()?;
        unk.ok_or_else(|| windows::core::Error::from(E_FAIL))?.cast()
    }
}

fn default_client() -> windows::core::Result<IAudioClient> {
    unsafe {
        let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let dev = en.GetDefaultAudioEndpoint(eRender, eConsole)?;
        dev.Activate(CLSCTX_ALL, None)
    }
}

impl Audio {
    pub fn new() -> Audio {
        Audio { run: Arc::new(AtomicBool::new(false)), gen: Arc::new(AtomicU64::new(0)), ring: Arc::new(Mutex::new(Ring { pcm: vec![], pos: 0, full: false })) }
    }

    pub fn stop(&self) { self.run.store(false, Ordering::SeqCst); self.gen.fetch_add(1, Ordering::SeqCst); }

    pub fn start(&self, kbps: u32, keep_secs: u32, exclude: Option<u32>, include: Option<u32>) {
        self.stop();
        let my = self.gen.fetch_add(1, Ordering::SeqCst) + 1;
        self.run.store(true, Ordering::SeqCst);
        {
            let mut r = self.ring.lock().unwrap();
            r.pcm = vec![0i16; RATE * 2 * keep_secs.clamp(5, 120) as usize]; r.pos = 0; r.full = false;
        }
        let (run, gen, ring) = (self.run.clone(), self.gen.clone(), self.ring.clone());
        std::thread::spawn(move || {
            unsafe { let _ = CoInitializeEx(None, COINIT_MULTITHREADED); }
            mmcss("Pro Audio");
            if let Err(e) = capture(kbps, exclude, include, &run, &gen, my, &ring) {
                proto::event("audio", json!({ "on": false, "error": e }));
            }
        });
    }

    pub fn save_wav(&self, path: &str, secs: u32) -> bool {
        let r = self.ring.lock().unwrap();
        if r.pcm.is_empty() { return false; }
        let avail = if r.full { r.pcm.len() } else { r.pos };
        let want = avail.min(secs as usize * RATE * 2);
        let start = (r.pos + r.pcm.len() - want) % r.pcm.len();
        let mut data = Vec::with_capacity(44 + want * 2);
        let n = (want * 2) as u32;
        data.extend_from_slice(b"RIFF"); data.extend_from_slice(&(36 + n).to_le_bytes()); data.extend_from_slice(b"WAVEfmt ");
        data.extend_from_slice(&16u32.to_le_bytes()); data.extend_from_slice(&1u16.to_le_bytes()); data.extend_from_slice(&2u16.to_le_bytes());
        data.extend_from_slice(&(RATE as u32).to_le_bytes()); data.extend_from_slice(&(RATE as u32 * 4).to_le_bytes());
        data.extend_from_slice(&4u16.to_le_bytes()); data.extend_from_slice(&16u16.to_le_bytes());
        data.extend_from_slice(b"data"); data.extend_from_slice(&n.to_le_bytes());
        for i in 0..want { data.extend_from_slice(&r.pcm[(start + i) % r.pcm.len()].to_le_bytes()); }
        std::fs::write(path, data).is_ok()
    }
}

// raise this thread with the Multimedia Class Scheduler (what Windows does for audio engines)
pub fn mmcss(task: &str) {
    let w: Vec<u16> = task.encode_utf16().chain(Some(0)).collect();
    let mut idx = 0u32;
    unsafe { let _ = windows::Win32::System::Threading::AvSetMmThreadCharacteristicsW(windows::core::PCWSTR(w.as_ptr()), &mut idx); }
}

fn capture(kbps: u32, exclude: Option<u32>, include: Option<u32>, run: &AtomicBool, gen: &AtomicU64, my: u64, ring: &Mutex<Ring>) -> Result<(), String> {
    let live = || run.load(Ordering::SeqCst) && gen.load(Ordering::SeqCst) == my;
    // which sound: one process tree in or out, else everything
    let (client, mode) = match (include, exclude) {
        (Some(p), _) => (process_client(p, true).map_err(|e| e.to_string())?, "include"),
        (None, Some(p)) => match process_client(p, false) { Ok(c) => (c, "exclude"), Err(_) => (default_client().map_err(|e| e.to_string())?, "all") },
        _ => (default_client().map_err(|e| e.to_string())?, "all"),
    };
    unsafe {
        // ask for 48 kHz stereo float and let Windows convert (process loopback has no mix format)
        let fmt = WAVEFORMATEX { wFormatTag: 3, nChannels: 2, nSamplesPerSec: RATE as u32, nAvgBytesPerSec: RATE as u32 * 8, nBlockAlign: 8, wBitsPerSample: 32, cbSize: 0 };
        let flags = AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
        client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 200_000, 0, &fmt, None).map_err(|e| format!("init: {e}"))?;
        let ev = CreateEventW(None, false, false, None).map_err(|e| e.to_string())?;
        client.SetEventHandle(ev).map_err(|e| e.to_string())?;
        let cap: IAudioCaptureClient = client.GetService().map_err(|e| e.to_string())?;
        client.Start().map_err(|e| e.to_string())?;
        let mut err = 0i32;
        let enc = op::opus_encoder_create(RATE as i32, 2, op::OPUS_APPLICATION_RESTRICTED_LOWDELAY as i32, &mut err);
        if enc.is_null() { return Err(format!("opus {err}")); }
        op::opus_encoder_ctl(enc, op::OPUS_SET_BITRATE_REQUEST as i32, (kbps * 1000) as i32);
        op::opus_encoder_ctl(enc, op::OPUS_SET_COMPLEXITY_REQUEST as i32, 10i32);
        proto::event("audio", json!({ "on": true, "rate": RATE, "ch": 2, "mode": mode }));
        let mut pending: Vec<f32> = Vec::with_capacity(RATE);
        let mut out = [0u8; 1500];
        let mut seq: u32 = 0;
        while live() {
            if WaitForSingleObject(ev, 100) != WAIT_OBJECT_0 {
                // nothing playing: loopback goes quiet; keep the stream (and the clock) going
                pending.extend(std::iter::repeat(0.0).take(FRAME * 2 * 10));
            }
            loop {
                let n = cap.GetNextPacketSize().unwrap_or(0);
                if n == 0 { break; }
                let mut data = std::ptr::null_mut();
                let (mut frames, mut fl) = (0u32, 0u32);
                if cap.GetBuffer(&mut data, &mut frames, &mut fl, None, None).is_err() { break; }
                if fl & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data.is_null() {
                    pending.extend(std::iter::repeat(0.0).take(frames as usize * 2));
                } else {
                    pending.extend_from_slice(std::slice::from_raw_parts(data as *const f32, frames as usize * 2));
                }
                let _ = cap.ReleaseBuffer(frames);
            }
            let mut used = 0;
            while pending.len() - used >= FRAME * 2 {
                let pcm = &pending[used..used + FRAME * 2];
                {
                    let mut r = ring.lock().unwrap();
                    let len = r.pcm.len();
                    for &s in pcm { let p = r.pos; r.pcm[p] = (s.clamp(-1.0, 1.0) * 32767.0) as i16; r.pos = (p + 1) % len; if r.pos == 0 { r.full = true; } }
                }
                let n = op::opus_encode_float(enc, pcm.as_ptr(), FRAME as i32, out.as_mut_ptr(), out.len() as i32);
                if n > 0 {
                    let mut pkt = Vec::with_capacity(n as usize + 4);
                    pkt.extend_from_slice(&seq.to_le_bytes());
                    pkt.extend_from_slice(&out[..n as usize]);
                    seq = seq.wrapping_add(1);
                    proto::raw(2, &pkt);
                }
                used += FRAME * 2;
            }
            pending.drain(..used);
        }
        let _ = client.Stop();
        op::opus_encoder_destroy(enc);
        let _ = CloseHandle(ev);
    }
    Ok(())
}
