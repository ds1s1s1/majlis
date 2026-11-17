// majlis-engine: the hot part of hosting, out of Node and out of ffmpeg.
// Reads one JSON command per line on stdin, writes framed events/frames on stdout (proto.rs).
//
//   {"cmd":"hello"}
//   {"cmd":"start","id":1,"display":0 | "hwnd":123,"codec":"av1","kbps":12000,"fps":60,"w":1920,"h":1080,"quality":"balanced","tenBit":false}
//   {"cmd":"reconfig","id":1,"kbps":8000,"fps":60}      bitrate / frame rate, applied to the next frame
//   {"cmd":"idr","id":1}                                 keyframe now
//   {"cmd":"invalidate","id":1,"frames":[812,813]}      a viewer lost these: recover without a keyframe
//   {"cmd":"stop","id":1}
//   {"cmd":"quit"}
#![windows_subsystem = "windows"]
mod audio;
mod capture;
mod desk;
mod gpu;
mod input;
mod nvenc;
mod pads;
mod proto;
mod source;

use serde_json::{json, Value};
use source::{Cmd, SourceKind};
use std::collections::HashMap;
use std::io::BufRead;
use std::sync::mpsc::{channel, Sender};

struct Manager {
    sources: HashMap<String, Sender<Cmd>>,
    stream_src: HashMap<u8, String>,
}

impl Manager {
    fn send(&mut self, key: &str, kind: SourceKind, c: Cmd) {
        if let Some(tx) = self.sources.get(key) {
            match tx.send(c) {
                Ok(()) => return,
                Err(e) => { self.sources.remove(key); return self.spawn(key, kind, e.0); }
            }
        }
        self.spawn(key, kind, c);
    }

    fn spawn(&mut self, key: &str, kind: SourceKind, first: Cmd) {
        let (tx, rx) = channel();
        let _ = tx.send(first);
        std::thread::Builder::new().name(format!("src-{key}")).spawn(move || source::run(kind, rx)).ok();
        self.sources.insert(key.to_string(), tx);
    }

    fn to_stream(&mut self, id: u8, c: Cmd) {
        if let Some(key) = self.stream_src.get(&id).cloned() {
            if let Some(tx) = self.sources.get(&key) { let _ = tx.send(c); }
        }
    }
}

fn main() {
    unsafe {
        use windows::Win32::System::Threading::*;
        let _ = windows::Win32::Media::timeBeginPeriod(1);
        let _ = SetPriorityClass(GetCurrentProcess(), HIGH_PRIORITY_CLASS);
    }
    proto::event("ready", json!({ "version": env!("CARGO_PKG_VERSION"), "nvenc": nvenc::available().err().unwrap_or_default(), "ok": nvenc::available().is_ok() }));
    let mut m = Manager { sources: HashMap::new(), stream_src: HashMap::new() };
    let mut inp = input::Input::new();
    let mut pads = pads::Pads::new();
    let aud = audio::Audio::new();
    unsafe { let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED); }
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let Ok(c) = serde_json::from_str::<Value>(&line) else { continue };
        let id = c["id"].as_u64().unwrap_or(0) as u8;
        let u = |k: &str| c[k].as_u64().map(|v| v as u32);
        match c["cmd"].as_str().unwrap_or("") {
            "hello" => proto::event("hello", json!({ "ok": nvenc::available().is_ok(), "nvenc": nvenc::available().err().unwrap_or_default(), "vigem": pads.available(), "vigemError": pads.error, "displays": desk::displays(), "wgc": true, "engine": env!("CARGO_PKG_VERSION") })),
            // ---- the desktop side (what the C# helper used to do)
            "in" => { if let Some(e) = c["e"].as_array() { inp.apply(e); } }
            "capture_rect" => {
                let (x, y, w, h) = (c["x"].as_i64().unwrap_or(0) as i32, c["y"].as_i64().unwrap_or(0) as i32, c["w"].as_i64().unwrap_or(1920) as i32, c["h"].as_i64().unwrap_or(1080) as i32);
                inp.set_rect(x, y, w, h);
                *desk::CUR_RECT.lock().unwrap() = (x, y, w.max(1), h.max(1));
            }
            "release_all" => inp.release_all(),
            "displays" => proto::event("displays", json!({ "list": desk::displays() })),
            "windows" => proto::event("windows", json!({ "list": desk::windows_list() })),
            "icon" => { let p = c["path"].as_str().unwrap_or(""); proto::event("icon", json!({ "path": p, "png": desk::icon(p) })); }
            "mode" => proto::event("mode", json!({ "ok": false })), // never change the host's screen mode
            "mode_restore" => {}
            "pad_add" => pads.add(c["slot"].as_i64().unwrap_or(1), c["type"].as_str().unwrap_or("x360")),
            "pad" => pads.state(c["slot"].as_i64().unwrap_or(1), &c),
            "pad_motion" => pads.motion(c["slot"].as_i64().unwrap_or(1), &c),
            "pad_del" => pads.remove(c["slot"].as_i64().unwrap_or(1)),
            "pads_clear" => pads.remove_all(),
            "audio" => {
                if c["on"].as_bool().unwrap_or(false) {
                    aud.start(u("kbps").unwrap_or(128), u("keep").unwrap_or(30), c["exclude"].as_u64().map(|v| v as u32), c["include"].as_u64().map(|v| v as u32));
                } else { aud.stop(); }
            }
            "replay_audio" => { let p = c["path"].as_str().unwrap_or(""); proto::event("replay_audio", json!({ "path": p, "ok": aud.save_wav(p, u("seconds").unwrap_or(30)) })); }
            "cursor" => desk::cursor(c["on"].as_bool().unwrap_or(false)),
            "focus" => desk::focus(c["hwnd"].as_i64().unwrap_or(0)),
            "winprep" => proto::event("winprep", desk::winprep(c["hwnd"].as_i64().unwrap_or(0))),
            "gpu_prio" => { let pid = u("pid").unwrap_or(0); proto::event("gpu_prio", json!({ "pid": pid, "ok": desk::gpu_priority(pid) })); }
            "ptt" => desk::ptt(c["vk"].as_i64().unwrap_or(0) as i32),
            "wincap" | "wincap_stop" => {} // window capture lives in the encoder now
            "start" => {
                let (key, kind) = match c["hwnd"].as_i64() {
                    Some(h) => (format!("w{h}"), SourceKind::Window(h)),
                    None => { let d = c["display"].as_u64().unwrap_or(0) as usize; (format!("d{d}"), SourceKind::Display(d)) }
                };
                // a stream moving to another source leaves the old one
                if let Some(old) = m.stream_src.get(&id).cloned() { if old != key { m.to_stream(id, Cmd::Detach { id }); } }
                m.stream_src.insert(id, key.clone());
                let cmd = Cmd::Attach {
                    id,
                    codec: c["codec"].as_str().unwrap_or("h264").to_string(),
                    kbps: u("kbps").unwrap_or(8000),
                    fps: u("fps").unwrap_or(60),
                    w: u("w").unwrap_or(1920),
                    h: u("h").unwrap_or(1080),
                    quality: c["quality"].as_str().unwrap_or("balanced").to_string(),
                    ten_bit: c["tenBit"].as_bool().unwrap_or(false),
                };
                m.send(&key, kind, cmd);
            }
            "reconfig" => m.to_stream(id, Cmd::Reconfig { id, kbps: u("kbps"), fps: u("fps") }),
            "idr" => m.to_stream(id, Cmd::Idr { id }),
            "invalidate" => {
                let frames = c["frames"].as_array().map(|a| a.iter().filter_map(|v| v.as_u64().map(|x| x as u32)).collect()).unwrap_or_default();
                m.to_stream(id, Cmd::Invalidate { id, frames });
            }
            "stop" => { m.to_stream(id, Cmd::Detach { id }); m.stream_src.remove(&id); }
            "quit" => { pads.remove_all(); inp.release_all(); break; }
            _ => {}
        }
    }
    std::process::exit(0);
}
