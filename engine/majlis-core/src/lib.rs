// majlis-core: the per-packet half of Majlis' networking, native.
// JS keeps signaling, path selection and everything per-session; this does everything per
// packet: UDP I/O on its own threads, AES-GCM, Reed-Solomon, pacing, video reassembly,
// transport-wide feedback + rate control, and NACK repairs.
#![deny(clippy::all)]
pub mod crypto;
pub mod fec;
pub mod gcc;
pub mod link;
pub mod mpv_native;
pub mod netem;
pub mod proc_guard;
pub mod rx;
pub mod sock;
pub mod time;
pub mod tx;

pub use mpv_native::NativeMpvPlayer;

#[napi]
pub fn adopt_process(pid: u32) -> bool {
    proc_guard::adopt_pid(pid)
}

#[napi]
pub fn detect_display_hdr(hwnd_str: String) -> bool {
    let parsed = hwnd_str.trim().parse::<isize>().unwrap_or(0);
    proc_guard::detect_hdr_for_hwnd(parsed)
}

use link::{Ev, From, Link, Route};
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction};
use napi::{Env, JsFunction, JsObject, JsUnknown};
use napi_derive::napi;
use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Once};

fn addr(a: &str, port: u32) -> Result<SocketAddr> {
    let s = if a.contains(':') { format!("[{a}]:{port}") } else { format!("{a}:{port}") };
    s.parse().map_err(|_| Error::from_reason(format!("bad address {a}")))
}

// one thread for every link's timers: feedback every 50 ms, NACK checks, stale frames
fn ticker() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        std::thread::Builder::new().name("majlis-tick".into()).spawn(|| loop {
            std::thread::sleep(std::time::Duration::from_millis(10));
            let list: Vec<Arc<Link>> = sock::links().read().unwrap().values().flatten().cloned().collect();
            for l in list {
                l.flush_feedback();
                let nack = l.rx.lock().unwrap().tick();
                if let Some(b) = nack { l.send_body(&b); }
            }
        }).ok();
    });
}

#[napi]
pub struct Socket { inner: Arc<sock::Sock> }

#[napi]
impl Socket {
    // onMessage(buffer, address, port) for everything that isn't a session we hold keys for
    #[napi(constructor)]
    pub fn new(env: Env, v6: bool, port: u32, on_message: JsFunction) -> Result<Self> {
        let mut cb: ThreadsafeFunction<sock::RawMsg, ErrorStrategy::Fatal> = on_message.create_threadsafe_function(0, |ctx: ThreadSafeCallContext<sock::RawMsg>| {
            let m = ctx.value;
            Ok(vec![
                ctx.env.create_buffer_with_data(m.data)?.into_raw().into_unknown(),
                ctx.env.create_string(&m.from.ip().to_string())?.into_unknown(),
                ctx.env.create_uint32(m.from.port() as u32)?.into_unknown(),
            ])
        })?;
        cb.unref(&env)?;
        let inner = sock::open(v6, port as u16, cb).map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(Socket { inner })
    }

    #[napi(getter)]
    pub fn id(&self) -> u32 { self.inner.id }

    #[napi]
    pub fn port(&self) -> u32 { self.inner.udp.local_addr().map(|a| a.port() as u32).unwrap_or(0) }

    #[napi]
    pub fn send(&self, data: Buffer, port: u32, address: String) -> bool {
        match addr(&address, port) { Ok(a) => self.inner.udp.send_to(&data, a).is_ok(), Err(_) => false }
    }

    // a TURN channel we bound: ChannelData from (server, ch) is that peer, unwrapped natively
    #[napi]
    pub fn bind_channel(&self, server: String, server_port: u32, ch: u32, peer: String, peer_port: u32, turn_idx: u32) -> Result<()> {
        self.inner.chans.write().unwrap().insert((addr(&server, server_port)?, ch as u16), (addr(&peer, peer_port)?, turn_idx));
        Ok(())
    }

    #[napi]
    pub fn close(&self) { sock::close(self.inner.id); }
}

#[napi]
pub struct CoreLink { inner: Arc<Link> }

fn from_parts(env: &Env, f: From) -> Result<Vec<JsUnknown>> {
    Ok(match f {
        From::Udp { sock, addr } => vec![env.create_string(&addr.ip().to_string())?.into_unknown(), env.create_uint32(addr.port() as u32)?.into_unknown(), env.create_uint32(0)?.into_unknown(), env.create_uint32(sock)?.into_unknown()],
        From::Turn { sock, peer, turn } => vec![env.create_string(&peer.ip().to_string())?.into_unknown(), env.create_uint32(peer.port() as u32)?.into_unknown(), env.create_uint32(1 | (turn << 1))?.into_unknown(), env.create_uint32(sock)?.into_unknown()],
        From::Js => vec![env.get_null()?.into_unknown(), env.create_uint32(0)?.into_unknown(), env.create_uint32(2)?.into_unknown(), env.create_uint32(0)?.into_unknown()],
    })
}

#[napi]
impl CoreLink {
    // onEvent(kind, buffer, ...):
    //   1 body for JS (addr, port, flags[bit0 turn, turn index << 1], sockId)
    //   2 video frame (buffer = 24-byte meta + data)
    //   3 frame skipped to stay live (id)
    //   4 sealed packet to send through a JS-only path (TURN over TLS, WebSocket)
    #[napi(constructor)]
    pub fn new(env: Env, sid: u32, tx_key: Buffer, rx_key: Buffer, tx_dir: u32, rx_dir: u32, on_event: JsFunction) -> Result<Self> {
        let mut cb: ThreadsafeFunction<Ev, ErrorStrategy::Fatal> = on_event.create_threadsafe_function(0, |ctx: ThreadSafeCallContext<Ev>| {
            let env = ctx.env;
            Ok(match ctx.value {
                Ev::Plain { body, from } => { let mut v = vec![env.create_uint32(1)?.into_unknown(), env.create_buffer_with_data(body)?.into_raw().into_unknown()]; v.extend(from_parts(&env, from)?); v }
                Ev::Frame { meta, data } => { let mut b = Vec::with_capacity(24 + data.len()); b.extend_from_slice(&meta); b.extend_from_slice(&data); vec![env.create_uint32(2)?.into_unknown(), env.create_buffer_with_data(b)?.into_raw().into_unknown()] }
                Ev::Skip { id } => vec![env.create_uint32(3)?.into_unknown(), env.get_null()?.into_unknown(), env.create_uint32(id)?.into_unknown()],
                Ev::Send { pkt } => vec![env.create_uint32(4)?.into_unknown(), env.create_buffer_with_data(pkt)?.into_raw().into_unknown()],
            })
        })?;
        cb.unref(&env)?;
        let link = Arc::new(Link::new(sid, crypto::Cipher::new(&tx_key, &rx_key, tx_dir, rx_dir, sid), cb));
        sock::links().write().unwrap().entry(sid).or_default().push(link.clone());
        ticker();
        Ok(CoreLink { inner: link })
    }

    #[napi]
    pub fn seal(&self, body: Buffer) -> Buffer { self.inner.seal(&body).into() }

    // a sealed packet that reached JS another way (TURN indication, TLS, WebSocket)
    #[napi]
    pub fn open(&self, pkt: Buffer) -> Option<Buffer> { self.inner.open(&pkt, From::Js).map(|b| b.into()) }

    // where natively sent packets go: 0 nowhere, 1 UDP, 2 TURN channel, 3 through JS
    #[napi]
    pub fn set_route(&self, kind: u32, sock_id: u32, address: String, port: u32, ch: u32) -> Result<()> {
        let r = match kind {
            1 => Route::Udp { sock: sock_id, to: addr(&address, port)? },
            2 => Route::Turn { sock: sock_id, server: addr(&address, port)?, ch: ch as u16 },
            3 => Route::Js,
            _ => Route::None,
        };
        *self.inner.route.lock().unwrap() = r;
        Ok(())
    }

    #[napi]
    pub fn send_body(&self, body: Buffer) -> bool { self.inner.send_body(&body) }

    // receive-side numbers for JS: [msSinceLastRx, rxBytes, rxPkts]
    #[napi]
    pub fn poll(&self) -> Vec<f64> {
        let s = self.inner.stats.lock().unwrap();
        vec![(time::now_us().saturating_sub(s.last_rx_us)) as f64 / 1000.0, s.rx_bytes as f64, s.rx_pkts as f64]
    }

    #[napi]
    pub fn take_loss(&self) -> f64 { self.inner.take_loss() }

    // receiver options: send per-packet feedback; ask for repairs; film (frames may finish
    // out of order, long timeouts); the line's round trip
    #[napi]
    pub fn set_receive(&self, feedback: bool, nack: bool, film: bool, rtt_ms: f64) {
        self.inner.feedback_on.store(feedback, Ordering::Relaxed);
        let mut r = self.inner.rx.lock().unwrap();
        r.nack = nack; r.film = film; if rtt_ms > 0.0 { r.rtt_ms = rtt_ms; }
    }

    // video receive stats for the last window (JSON), same fields as VideoRx.report()
    #[napi]
    pub fn rx_report(&self) -> String { self.inner.rx.lock().unwrap().report() }

    fn tx(&self) -> Arc<tx::Sender> {
        let mut t = self.inner.tx.lock().unwrap();
        t.get_or_insert_with(|| tx::Sender::start(&self.inner)).clone()
    }

    #[napi]
    pub fn tx_frame(&self, data: Buffer, key: bool, epoch: u32, id: u32, enc_ms: u32, pts: u32) {
        self.tx().send_frame(&self.inner, &data, key, epoch as u8, id, enc_ms.min(255) as u8, pts);
    }

    #[napi]
    pub fn tx_raw(&self, body: Buffer) { self.tx().send_raw(body.to_vec()); }

    // pacing rate (kbps), keyed = film mode
    #[napi]
    pub fn tx_set(&self, rate_kbps: f64, keyed: bool) {
        let t = self.tx();
        let mut st = t.st.lock().unwrap();
        st.rate_kbps = rate_kbps; st.keyed = keyed;
    }

    #[napi]
    pub fn tx_clock(&self, pos: f64, at: f64, playing: bool) { self.tx().set_clock(pos, at, playing); }

    #[napi]
    pub fn tx_flush(&self) { self.tx().flush(); }

    // [sentPts (-1 none), skipped, queue length, repaired packets, fec ratio]
    #[napi]
    pub fn tx_state(&self) -> Vec<f64> {
        let t = self.tx();
        let st = t.st.lock().unwrap();
        vec![st.sent_pts.map(|p| p as f64).unwrap_or(-1.0), st.skipped as f64, t_queue(&st) as f64, st.repaired as f64, st.fec_ratio]
    }

    // rate control: [target, lossEw, congestions, lastDrop (ms ago), acked kbps, trend, fec]
    #[napi]
    pub fn rate(&self) -> Vec<f64> {
        let t = self.tx();
        let g = t.gcc.lock().unwrap();
        vec![g.target, g.loss_ew, g.congestions as f64, if g.last_drop_ms > 0.0 { time::now_ms() - g.last_drop_ms } else { 1e9 }, g.acked_kbps, g.trend, g.fec_ratio()]
    }

    // set target / bounds / stability (negative = leave as is)
    #[napi]
    pub fn rate_set(&self, target: f64, min: f64, max: f64, stability: i32) {
        let t = self.tx();
        let mut g = t.gcc.lock().unwrap();
        if min > 0.0 { g.min = min; }
        if max > 0.0 { g.max = max; }
        if target > 0.0 { g.target = target; }
        g.target = g.target.clamp(g.min, g.max.max(g.min));
        if stability >= 0 { g.stability = stability > 0; }
    }

    #[napi]
    pub fn close(&self) {
        self.inner.closed.store(true, Ordering::Relaxed);
        if let Some(t) = self.inner.tx.lock().unwrap().take() { t.stop(); }
        let mut m = sock::links().write().unwrap();
        if let Some(v) = m.get_mut(&self.inner.sid) { v.retain(|l| !Arc::ptr_eq(l, &self.inner)); if v.is_empty() { m.remove(&self.inner.sid); } }
    }
}

fn t_queue(st: &std::sync::MutexGuard<tx::State>) -> usize { let _ = st; 0 }

// self-checks the JS side runs once against its own implementation
#[napi]
pub fn fec_parity(shards: Vec<Buffer>, from: u32, count: u32) -> Vec<Buffer> {
    let refs: Vec<&[u8]> = shards.iter().map(|b| b.as_ref()).collect();
    fec::parity(&refs, from as usize, count as usize).into_iter().map(|v| v.into()).collect()
}

#[napi]
pub fn version() -> String { env!("CARGO_PKG_VERSION").to_string() }

#[allow(dead_code)]
fn unused(_: JsObject) {}
