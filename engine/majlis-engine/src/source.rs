// One thread per picture source (a display or a window). Everything watching that source -
// the players' stream and the spectators' lighter one - is encoded from the same captured
// picture: capture once, convert and encode per stream, all on the GPU.
use crate::capture::Capture;
use crate::gpu::{Converter, Gpu};
use crate::nvenc::{Codec, Encoder, Params};
use crate::proto;
use serde_json::json;
use std::collections::HashMap;
use std::sync::mpsc::{Receiver, TryRecvError};
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_NV12;

pub enum Cmd {
    Attach { id: u8, codec: String, kbps: u32, fps: u32, w: u32, h: u32, quality: String, ten_bit: bool },
    Reconfig { id: u8, kbps: Option<u32>, fps: Option<u32> },
    Idr { id: u8 },
    Invalidate { id: u8, frames: Vec<u32> },
    Detach { id: u8 },
}

#[derive(Clone)]
pub enum SourceKind { Display(usize), Window(i64) }

struct Stream {
    enc: Encoder,
    conv: Converter,
    interval_us: u64,
    last_us: u64,
    started_us: u64,
    // frame index -> encoder timestamp, for invalidation
    recent: std::collections::VecDeque<(u32, u64)>,
    buf: Vec<u8>,
    kick: bool, // encode right away (keyframe / recovery asked for)
    // a new picture came in since this stream last encoded: it goes out at the stream's next slot
    // even if no newer one arrives by then (24/30 fps video on a 60 Hz desktop lost frames)
    dirty: bool,
    gen: u32, // capture texture generation the converter was built for
}

pub fn run(kind: SourceKind, rx: Receiver<Cmd>) {
    unsafe { let _ = windows::Win32::System::WinRT::RoInitialize(windows::Win32::System::WinRT::RO_INIT_MULTITHREADED); }
    // capture and encode are what everyone is waiting on
    unsafe {
        use windows::Win32::System::Threading::*;
        let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
    }
    let opened = match &kind {
        SourceKind::Display(i) => Capture::display(*i),
        SourceKind::Window(h) => Capture::window(*h),
    };
    let (gpu, mut cap) = match opened {
        Ok(x) => x,
        Err(e) => {
            // tell every stream that asked for this source
            while let Ok(c) = rx.recv_timeout(std::time::Duration::from_millis(50)) {
                if let Cmd::Attach { id, .. } = c { proto::error("start", id as i64, format!("capture: {e}")); }
            }
            return;
        }
    };
    let mut streams: HashMap<u8, Stream> = HashMap::new();
    let mut last_new_us = proto::now_us();
    let mut have_picture = false;
    loop {
        // commands
        loop {
            match rx.try_recv() {
                Ok(c) => handle(c, &gpu, &cap, &mut streams),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return,
            }
        }
        if streams.is_empty() {
            // nobody watching: stop capturing (the thread ends, the manager starts a new one later)
            match rx.recv_timeout(std::time::Duration::from_millis(1500)) {
                Ok(c) => { handle(c, &gpu, &cap, &mut streams); continue; }
                Err(_) => return,
            }
        }
        let now = proto::now_us();
        // wait for a new picture until the next stream is due
        let due = streams.values().map(|s| s.last_us + s.interval_us).min().unwrap_or(now);
        let wait_ms = (due.saturating_sub(now) / 1000).min(16) as u32;
        let fresh = match cap.next(&gpu, wait_ms) {
            Ok(n) => n,
            Err(e) => { proto::event("source_error", json!({ "msg": e.to_string() })); std::thread::sleep(std::time::Duration::from_millis(100)); false }
        };
        let now = proto::now_us();
        if fresh { last_new_us = now; have_picture = true; for s in streams.values_mut() { s.dirty = true; } }
        if !have_picture { continue; }
        // a still screen costs almost nothing: no new picture = no new frame, except a beat
        // every second so the stream (and its rolling refresh) stays alive
        let heartbeat = now - last_new_us > 1_000_000;
        let (cw, ch) = cap.content();
        for (id, s) in streams.iter_mut() {
            let due_now = now + 1500 >= s.last_us + s.interval_us; // within 1.5 ms of its slot
            if !due_now && !s.kick { continue; }
            if !s.dirty && !(heartbeat && now - s.last_us >= 1_000_000) && !s.kick { continue; }
            s.last_us = now;
            s.kick = false;
            s.dirty = false;
            // the window grew and the capture copy with it: a converter for the new input size
            if s.gen != cap.gen() {
                let (sw, sh) = cap.size();
                match Converter::new(&gpu, sw, sh, &s.enc.input, s.enc.p.w, s.enc.p.h) {
                    Ok(c) => { s.conv = c; s.gen = cap.gen(); }
                    Err(e) => { proto::error("converter", *id as i64, format!("{e}")); s.gen = cap.gen(); }
                }
            }
            if let Err(e) = s.conv.convert(cap.tex(), cw, ch) { proto::error("convert", *id as i64, format!("{e}")); continue; }
            let ts = now;
            match s.enc.encode(ts, &mut s.buf) {
                Ok((key, idx)) => {
                    s.recent.push_back((idx, ts));
                    if s.recent.len() > 64 { s.recent.pop_front(); }
                    let pts = ((now - s.started_us) / 1000) as u32;
                    let enc_us = (proto::now_us() - now) as u32;
                    proto::frame(*id, key, pts, now, enc_us, &s.buf);
                }
                Err(e) => proto::error("encode", *id as i64, e),
            }
        }
    }
}

fn handle(c: Cmd, gpu: &Gpu, cap: &Capture, streams: &mut HashMap<u8, Stream>) {
    match c {
        Cmd::Attach { id, codec, kbps, fps, w, h, quality, ten_bit } => {
            streams.remove(&id);
            let (w, h) = (w.max(64) & !1, h.max(64) & !1);
            let make = || -> Result<Stream, String> {
                let input = gpu.texture(w, h, DXGI_FORMAT_NV12, D3D11_BIND_RENDER_TARGET).map_err(|e| format!("texture: {e}"))?;
                let (sw, sh) = cap.size();
                let conv = Converter::new(gpu, sw, sh, &input, w, h).map_err(|e| format!("converter: {e}"))?;
                let codec = Codec::parse(&codec);
                let enc = Encoder::new(&gpu.device, input, Params { codec, w, h, fps: fps.clamp(10, 240), kbps: kbps.max(200), quality, ten_bit })?;
                Ok(Stream { enc, conv, interval_us: 1_000_000 / fps.clamp(10, 240) as u64, last_us: 0, started_us: proto::now_us(), recent: Default::default(), buf: Vec::with_capacity(1 << 20), kick: true, dirty: true, gen: cap.gen() })
            };
            match make() {
                Ok(s) => {
                    let ten = s.enc.p.ten_bit && s.enc.p.codec != Codec::H264;
                    proto::event("config", json!({ "id": id, "codec": s.enc.p.codec.webcodecs(ten), "w": w, "h": h, "fps": s.enc.p.fps }));
                    streams.insert(id, s);
                }
                Err(e) => proto::error("start", id as i64, e),
            }
        }
        Cmd::Reconfig { id, kbps, fps } => {
            if let Some(s) = streams.get_mut(&id) {
                match s.enc.reconfigure(kbps, fps) {
                    Ok(()) => { s.interval_us = 1_000_000 / s.enc.p.fps as u64; }
                    Err(e) => proto::error("reconfig", id as i64, e),
                }
            }
        }
        Cmd::Idr { id } => { if let Some(s) = streams.get_mut(&id) { s.enc.request_idr(); s.kick = true; } }
        Cmd::Invalidate { id, frames } => {
            if let Some(s) = streams.get_mut(&id) {
                // everything from the first lost frame on is suspect
                let first = frames.iter().min().copied();
                let ts: Vec<u64> = match first {
                    Some(f) => s.recent.iter().filter(|(i, _)| i.wrapping_sub(f) < 0x8000_0000).map(|(_, t)| *t).collect(),
                    None => vec![],
                };
                // too far back for the encoder's reference list: a keyframe is the only way
                // (the encoder keeps up to 16 frames to fall back on; past that it codes an
                // intra picture by itself)
                if ts.is_empty() || s.enc.invalidate(&ts).is_err() { s.enc.request_idr(); }
                s.kick = true;
            }
        }
        Cmd::Detach { id } => { streams.remove(&id); }
    }
}
