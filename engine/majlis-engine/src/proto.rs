// Output to the app: framed messages on stdout, the same framing the C# helper uses.
//   [type u8][length u32 LE][payload]
//   1 = JSON event
//   4 = encoded video frame: [stream u8][flags u8][pts u32][capture_us u64][encode_us u32][data]
//       flags: bit0 keyframe
use std::io::Write;
use std::sync::Mutex;

static OUT: Mutex<()> = Mutex::new(());

fn send(kind: u8, parts: &[&[u8]]) {
    let len: usize = parts.iter().map(|p| p.len()).sum();
    let _g = OUT.lock().unwrap();
    let mut out = std::io::stdout().lock();
    let mut head = [0u8; 5];
    head[0] = kind;
    head[1..].copy_from_slice(&(len as u32).to_le_bytes());
    let ok = out.write_all(&head).is_ok() && parts.iter().all(|p| out.write_all(p).is_ok()) && out.flush().is_ok();
    if !ok {
        // the app went away
        std::process::exit(0);
    }
}

pub fn event(ev: &str, mut data: serde_json::Value) {
    if let Some(o) = data.as_object_mut() {
        o.insert("ev".into(), ev.into());
    }
    send(1, &[data.to_string().as_bytes()]);
}

pub fn error(cmd: &str, id: i64, msg: impl std::fmt::Display) {
    event("error", serde_json::json!({ "cmd": cmd, "id": id, "msg": msg.to_string() }));
}

pub fn frame(stream: u8, key: bool, pts_ms: u32, capture_us: u64, encode_us: u32, data: &[u8]) {
    let mut h = [0u8; 18];
    h[0] = stream;
    h[1] = key as u8;
    h[2..6].copy_from_slice(&pts_ms.to_le_bytes());
    h[6..14].copy_from_slice(&capture_us.to_le_bytes());
    h[14..18].copy_from_slice(&encode_us.to_le_bytes());
    send(4, &[&h, data]);
}

// Monotonic microseconds (QueryPerformanceCounter)
pub fn now_us() -> u64 {
    use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};
    static FREQ: std::sync::OnceLock<i64> = std::sync::OnceLock::new();
    let f = *FREQ.get_or_init(|| {
        let mut f = 0i64;
        unsafe { let _ = QueryPerformanceFrequency(&mut f); }
        f.max(1)
    });
    let mut c = 0i64;
    unsafe { let _ = QueryPerformanceCounter(&mut c); }
    ((c as i128) * 1_000_000 / f as i128) as u64
}
