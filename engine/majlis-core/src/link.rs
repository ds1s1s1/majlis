// One encrypted session with one peer: sealing/opening (shared counter with JS), the route
// packets leave by, receive-side bookkeeping, transport-wide feedback for rate control, and
// the video sender / receiver.
use crate::crypto::{Cipher, Replay};
use crate::rx::Receiver;
use crate::sock::socks;
use crate::time::{now_ms, now_us};
use crate::tx::Sender;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Clone, Copy, Debug)]
pub enum From { Udp { sock: u32, addr: SocketAddr }, Turn { sock: u32, peer: SocketAddr, turn: u32 }, Js }

pub enum Ev {
    Plain { body: Vec<u8>, from: From },
    Frame { meta: [u8; 24], data: Vec<u8> },
    Skip { id: u32 },
    Send { pkt: Vec<u8> },
}

#[derive(Clone)]
pub enum Route { None, Udp { sock: u32, to: SocketAddr }, Turn { sock: u32, server: SocketAddr, ch: u16 }, Js }

pub struct Stats { pub rx_bytes: u64, pub rx_pkts: u64, pub last_rx_us: u64, pub last_from: Option<From>, pub win_start: Option<u64>, pub win_max: u64, pub win_n: u64 }

// arrival bookkeeping for transport-wide feedback: groups of packets that landed within 5 ms
#[derive(Default, Clone, Copy)]
pub struct Group { pub first: u64, pub last: u64, pub count: u32, pub arr_us: u64, pub start_us: u64 }

pub struct Link {
    pub sid: u32,
    pub cipher: Cipher,
    pub ctr: AtomicU64,
    replay: Mutex<Replay>,
    pub stats: Mutex<Stats>,
    pub route: Mutex<Route>,
    pub cb: ThreadsafeFunction<Ev, ErrorStrategy::Fatal>,
    // ctr -> (send time ms, size) for the last 16k packets we sealed
    pub sent: Mutex<Vec<(u64, f64, u32)>>,
    pub feedback_on: AtomicBool,
    groups: Mutex<(Vec<Group>, Group, u64, Vec<u64>)>, // done, current, last flush us, counters received
    pub rx: Mutex<Receiver>,
    pub tx: Mutex<Option<Arc<Sender>>>,
    pub closed: AtomicBool,
}

const SENT: usize = 16384;

impl Link {
    pub fn new(sid: u32, cipher: Cipher, cb: ThreadsafeFunction<Ev, ErrorStrategy::Fatal>) -> Link {
        Link {
            sid, cipher, ctr: AtomicU64::new(0), replay: Mutex::new(Replay::new()),
            stats: Mutex::new(Stats { rx_bytes: 0, rx_pkts: 0, last_rx_us: now_us(), last_from: None, win_start: None, win_max: 0, win_n: 0 }),
            route: Mutex::new(Route::None), cb, sent: Mutex::new(vec![(u64::MAX, 0.0, 0); SENT]),
            feedback_on: AtomicBool::new(false), groups: Mutex::new((vec![], Group::default(), now_us(), vec![])),
            rx: Mutex::new(Receiver::new()), tx: Mutex::new(None), closed: AtomicBool::new(false),
        }
    }

    pub fn seal(&self, body: &[u8]) -> Vec<u8> {
        let c = self.ctr.fetch_add(1, Ordering::Relaxed);
        let pkt = self.cipher.seal(c, body);
        self.sent.lock().unwrap()[(c as usize) % SENT] = (c, now_ms(), pkt.len() as u32);
        pkt
    }

    pub fn sent_info(&self, c: u64) -> Option<(f64, u32)> {
        let e = self.sent.lock().unwrap()[(c as usize) % SENT];
        if e.0 == c { Some((e.1, e.2)) } else { None }
    }

    // seal and send over the current route (packets that never go through JS)
    pub fn send_body(&self, body: &[u8]) -> bool {
        let pkt = self.seal(body);
        self.send_sealed(pkt)
    }

    pub fn send_sealed(&self, pkt: Vec<u8>) -> bool {
        let route = self.route.lock().unwrap().clone();
        // test aid: an emulated line on the host's outgoing side (MAJLIS_NETEM)
        if self.cipher.tx_dir() == 2 { if let Some(ok) = crate::netem::offer(self.sid, &route, &pkt) { return ok; } }
        transmit(&self.cb, &route, pkt)
    }
}

pub fn transmit(cb: &ThreadsafeFunction<Ev, ErrorStrategy::Fatal>, route: &Route, pkt: Vec<u8>) -> bool {
    {
        let route = route.clone();
        match route {
            Route::None => false,
            Route::Js => { cb.call(Ev::Send { pkt }, ThreadsafeFunctionCallMode::NonBlocking); true }
            Route::Udp { sock, to } => {
                let s = socks().read().unwrap().get(&sock).cloned();
                s.map(|s| s.udp.send_to(&pkt, to).is_ok()).unwrap_or(false)
            }
            Route::Turn { sock, server, ch } => {
                let s = socks().read().unwrap().get(&sock).cloned();
                let Some(s) = s else { return false };
                let mut b = Vec::with_capacity(4 + pkt.len());
                b.extend_from_slice(&ch.to_be_bytes());
                b.extend_from_slice(&(pkt.len() as u16).to_be_bytes());
                b.extend_from_slice(&pkt);
                s.udp.send_to(&b, server).is_ok()
            }
        }
    }
}

impl Link {

    // A packet for this session, wherever it came from. Returns the body if JS should see it.
    pub fn open(&self, pkt: &[u8], from: From) -> Option<Vec<u8>> { self.open2(pkt, from).flatten() }

    // None = not ours / not genuine; Some(None) = genuine, handled here; Some(Some(body)) = for JS
    pub fn open2(&self, pkt: &[u8], from: From) -> Option<Option<Vec<u8>>> {
        let (c, body) = self.cipher.open(pkt)?;
        if !self.replay.lock().unwrap().check(c) { return Some(None); }
        let t = now_us();
        {
            let mut s = self.stats.lock().unwrap();
            s.rx_bytes += pkt.len() as u64; s.rx_pkts += 1; s.last_rx_us = t; s.last_from = Some(from);
            if s.win_start.is_none() { s.win_start = Some(c); s.win_max = c; }
            if c > s.win_max { s.win_max = c; }
            if c >= s.win_start.unwrap() { s.win_n += 1; }
        }
        if self.feedback_on.load(Ordering::Relaxed) { self.record(c, t); }
        if body.is_empty() { return Some(None); }
        Some(match body[0] {
            0x01 => { let ev = self.rx.lock().unwrap().push(&body, pkt.len()); for e in ev { self.cb.call(e, ThreadsafeFunctionCallMode::NonBlocking); } None }
            0x0d => { if let Some(tx) = self.tx.lock().unwrap().clone() { tx.on_feedback(self, &body); } None }
            0x0e => { if let Some(tx) = self.tx.lock().unwrap().clone() { tx.on_nack(&body); } None }
            _ => { self.rx.lock().unwrap().count(pkt.len()); Some(body) }
        })
    }

    // true if this packet was genuinely ours
    pub fn on_packet(&self, pkt: &[u8], from: From) -> bool {
        match self.open2(pkt, from) {
            None => false,
            Some(Some(body)) => { self.cb.call(Ev::Plain { body, from }, ThreadsafeFunctionCallMode::NonBlocking); true }
            Some(None) => true,
        }
    }

    fn record(&self, c: u64, t: u64) {
        let mut g = self.groups.lock().unwrap();
        g.3.push(c);
        let cur = &mut g.1;
        if cur.count > 0 && t - cur.start_us > 5000 { let done = *cur; g.0.push(done); g.1 = Group::default(); }
        let cur = &mut g.1;
        if cur.count == 0 { *cur = Group { first: c, last: c, count: 0, arr_us: t, start_us: t }; }
        cur.count += 1; cur.arr_us = t; if c > cur.last { cur.last = c; } if c < cur.first { cur.first = c; }
    }

    // every ~50 ms: tell the sender how its packets arrived
    //   [0x0d][n u8] n x ([first u32][last u32][count u16][arrival us u32])
    //   then [base u32][bits u16 count][bitmap]: exactly which counters got here (late ones
    //   included), so reordering never looks like loss
    pub fn flush_feedback(&self) {
        if !self.feedback_on.load(Ordering::Relaxed) { return; }
        let t = now_us();
        let (groups, mut got) = {
            let mut g = self.groups.lock().unwrap();
            if t - g.2 < 50_000 { return; }
            g.2 = t;
            if g.1.count > 0 && t - g.1.start_us > 5000 { let d = g.1; g.0.push(d); g.1 = Group::default(); }
            (std::mem::take(&mut g.0), std::mem::take(&mut g.3))
        };
        got.sort_unstable();
        let bitmaps: Vec<Vec<u8>> = {
            // split into runs that fit a packet (8000 counters each)
            let mut out = vec![];
            let mut i = 0;
            while i < got.len() {
                let base = got[i];
                let mut bits = vec![0u8; 1000];
                let mut maxo = 0usize;
                while i < got.len() && got[i] - base < 8000 { let o = (got[i] - base) as usize; bits[o >> 3] |= 1 << (o & 7); maxo = o; i += 1; }
                let nbits = maxo + 1;
                bits.truncate(nbits.div_ceil(8));
                let mut b = Vec::with_capacity(6 + bits.len());
                b.extend_from_slice(&(base as u32).to_be_bytes());
                b.extend_from_slice(&(nbits as u16).to_be_bytes());
                b.extend_from_slice(&bits);
                out.push(b);
            }
            out
        };
        let mut chunks: Vec<&[Group]> = groups.chunks(70).collect();
        while chunks.len() < bitmaps.len() { chunks.push(&[]); }
        for (ci, chunk) in chunks.into_iter().enumerate() {
            let mut b = Vec::with_capacity(2 + chunk.len() * 14);
            b.push(0x0d); b.push(chunk.len() as u8);
            for gr in chunk {
                b.extend_from_slice(&(gr.first as u32).to_be_bytes());
                b.extend_from_slice(&(gr.last as u32).to_be_bytes());
                b.extend_from_slice(&(gr.count.min(65535) as u16).to_be_bytes());
                b.extend_from_slice(&(gr.arr_us as u32).to_be_bytes());
            }
            if let Some(bm) = bitmaps.get(ci) { b.extend_from_slice(bm); }
            self.send_body(&b);
        }
    }

    // fraction of packets lost since the last call (from counter gaps, like the JS did)
    pub fn take_loss(&self) -> f64 {
        let mut s = self.stats.lock().unwrap();
        let Some(start) = s.win_start else { return 0.0 };
        let expected = s.win_max as i64 - start as i64 + 1;
        let loss = if expected > 0 { (1.0 - s.win_n as f64 / expected as f64).max(0.0) } else { 0.0 };
        s.win_start = Some(s.win_max + 1); s.win_n = 0;
        (loss * 1000.0).round() / 1000.0
    }
}
