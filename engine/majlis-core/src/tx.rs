// Video send side (same packets as VideoTx in media.js): frame -> 1100-byte shards -> blocks
// of up to 32 with Reed-Solomon parity -> a paced queue drained by its own thread at the
// rate control's pace, sealed at the moment each packet leaves.
//   - live video: never more than ~500 ms queued on our side; a dropped frame is reported so
//     the encoder stops referencing it
//   - film: seconds ahead on purpose; a frame is only given up on when it would land after
//     its moment on screen (then skip to the next keyframe)
//   - NACK repairs (fresh parity rows) jump the queue
//   - rate control (gcc.rs) from the receiver's per-packet feedback
use crate::fec;
use crate::gcc::Gcc;
use crate::link::{Ev, Link};
use crate::rx::{SHARD, VHDR};
use crate::time::{now_ms, now_us, wall_ms, Sleeper};
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Condvar, Mutex, Weak};

const MAXK: usize = 32;

struct TxFrame { pkts: Vec<Vec<u8>>, i: usize, key: bool, pts: u32, raw: bool, fk: (u8, u32) }
struct Stored { t: f64, blocks: Vec<(usize, usize, Vec<Vec<u8>>)>, header: [u8; VHDR] } // (k, next parity row, data shards)

pub struct State {
    queue: VecDeque<TxFrame>,
    prio: VecDeque<Vec<u8>>,
    pub rate_kbps: f64,
    pub fec_ratio: f64,
    pub keyed: bool,
    skip_to_key: bool,
    pub skipped: u32,
    pub sent_pts: Option<u32>,
    clock: Option<(f64, f64)>, // film clock: (pos ms, host wall ms when pos is on screen)
    store: VecDeque<((u8, u32), Stored)>,
    index: HashMap<(u8, u32), usize>,
    store_base: usize,
    tokens: f64,
    last_refill: f64,
    pub sent_bytes: VecDeque<(f64, usize)>,
    stop: bool,
    pub repaired: u32,
    repair_win: (f64, f64), // (window start ms, bytes used)
}

pub struct Sender {
    pub st: Mutex<State>,
    cv: Condvar,
    pub gcc: Mutex<Gcc>,
    fb_prev: Mutex<Option<(u64, f64)>>, // last group's (last ctr, arrival ms unwrapped)
    // which of our counters the other side confirmed, and how far we've judged loss
    got: Mutex<(Vec<u64>, u64)>,
    arr_wrap: Mutex<(u32, f64)>,
}

impl Sender {
    pub fn start(link: &Arc<Link>) -> Arc<Sender> {
        let s = Arc::new(Sender {
            st: Mutex::new(State {
                queue: VecDeque::new(), prio: VecDeque::new(), rate_kbps: 20000.0, fec_ratio: 0.1, keyed: false, skip_to_key: false, skipped: 0, sent_pts: None,
                clock: None, store: VecDeque::new(), index: HashMap::new(), store_base: 0, tokens: 0.0, last_refill: now_ms(), sent_bytes: VecDeque::new(), stop: false, repaired: 0, repair_win: (0.0, 0.0),
            }),
            cv: Condvar::new(),
            gcc: Mutex::new(Gcc::new(8000.0, 1500.0, 40000.0)),
            fb_prev: Mutex::new(None),
            arr_wrap: Mutex::new((0, 0.0)),
            got: Mutex::new((vec![u64::MAX; 16384], u64::MAX)),
        });
        let (s2, l2) = (s.clone(), Arc::downgrade(link));
        std::thread::Builder::new().name("majlis-pacer".into()).spawn(move || pace(s2, l2)).ok();
        s
    }

    pub fn stop(&self) { self.st.lock().unwrap().stop = true; self.cv.notify_all(); }

    pub fn send_frame(&self, link: &Link, data: &[u8], key: bool, epoch: u8, id: u32, enc_ms: u8, pts: u32) {
        let total = data.len().div_ceil(SHARD).max(1);
        let nblocks = total.div_ceil(MAXK);
        let mut st = self.st.lock().unwrap();
        let fec = st.fec_ratio;
        let mut pkts = Vec::with_capacity(total + total / 4 + 4);
        let mut header = [0u8; VHDR];
        header[0] = 0x01; header[1] = epoch; header[2..6].copy_from_slice(&id.to_be_bytes()); header[6] = key as u8;
        header[11] = enc_ms; header[12..16].copy_from_slice(&(data.len() as u32).to_be_bytes()); header[17] = nblocks as u8;
        header[21..25].copy_from_slice(&pts.to_be_bytes());
        let mut stored = Stored { t: now_ms(), blocks: Vec::with_capacity(nblocks), header };
        for b in 0..nblocks {
            let first = b * MAXK;
            let k = MAXK.min(total - first);
            // keyframes are what everything after them depends on: protect them harder
            let r = if key { fec.max(0.3) } else { fec };
            let m = ((k as f64 * r).ceil() as usize).max(if key { 3 } else { 1 }).min(255 - k);
            let shards: Vec<Vec<u8>> = (0..k).map(|i| {
                let off = (first + i) * SHARD;
                let mut s = vec![0u8; SHARD];
                if off < data.len() { let end = (off + SHARD).min(data.len()); s[..end - off].copy_from_slice(&data[off..end]); }
                s
            }).collect();
            let refs: Vec<&[u8]> = shards.iter().map(|s| s.as_slice()).collect();
            let par = fec::parity(&refs, 0, m);
            for (i, sh) in shards.iter().chain(par.iter()).enumerate() {
                let mut p = Vec::with_capacity(VHDR + SHARD);
                p.extend_from_slice(&header);
                p[16] = b as u8; p[18] = i as u8; p[19] = k as u8; p[20] = m as u8;
                p.extend_from_slice(sh);
                pkts.push(p);
            }
            stored.blocks.push((k, m, shards));
        }
        // what's waiting behind the frame going out now (that one may be big)
        let queued: usize = st.queue.iter().skip(1).map(|f| f.pkts.len() - f.i).sum::<usize>() * 1185;
        let limit = if st.keyed { 64_000_000.0 } else { (st.rate_kbps.max(800.0) / 8.0 * 500.0).max(200_000.0) };
        if st.skip_to_key && !key { st.skipped += 1; return; }
        if queued as f64 > limit {
            if key { st.queue.retain(|f| f.i > 0 && f.i < f.pkts.len()); }
            else {
                st.skipped += 1;
                if st.keyed { st.skip_to_key = true; } else { link.cb.call(Ev::Skip { id }, ThreadsafeFunctionCallMode::NonBlocking); }
                return;
            }
        }
        if key { st.skip_to_key = false; }
        // keep the shards a few seconds so a viewer can ask for repairs (only frames we send)
        let t = now_ms();
        while st.store.front().map(|s| t - s.1.t > 3000.0).unwrap_or(false) || st.store.len() > 600 {
            let (k, _) = st.store.pop_front().unwrap(); st.index.remove(&k); st.store_base += 1;
        }
        let pos = st.store_base + st.store.len();
        st.index.insert((epoch, id), pos);
        st.store.push_back(((epoch, id), stored));
        st.queue.push_back(TxFrame { pkts, i: 0, key, pts, raw: false, fk: (epoch, id) });
        drop(st);
        self.cv.notify_one();
    }

    // something that rides the paced queue in order with the picture (film audio)
    pub fn send_raw(&self, body: Vec<u8>) {
        self.st.lock().unwrap().queue.push_back(TxFrame { pkts: vec![body], i: 0, key: true, pts: 0, raw: true, fk: (0, 0) });
        self.cv.notify_one();
    }

    pub fn flush(&self) {
        let mut st = self.st.lock().unwrap();
        st.queue.retain(|f| f.i > 0 && f.i < f.pkts.len());
        st.skip_to_key = false; st.sent_pts = None;
    }

    pub fn set_clock(&self, pos: f64, at: f64, playing: bool) {
        self.st.lock().unwrap().clock = if playing && at > 0.0 { Some((pos, at)) } else { None };
    }

    pub fn queue_len(&self) -> usize { self.st.lock().unwrap().queue.len() }

    // [0x0e][n] n x ([epoch][id u32][block][need]): fresh parity rows for exactly that
    pub fn on_nack(&self, b: &[u8]) {
        if b.len() < 2 { return; }
        let n = b[1] as usize;
        let mut st = self.st.lock().unwrap();
        // repairs may use at most a quarter of the line, so a lossy patch can't snowball
        let t = now_ms();
        if t - st.repair_win.0 > 1000.0 { st.repair_win = (t, 0.0); }
        let budget = st.rate_kbps * 1000.0 / 8.0 * 0.25 - st.repair_win.1;
        if budget <= 0.0 { return; }
        let mut out = vec![];
        for e in 0..n {
            let o = 2 + e * 7;
            if o + 7 > b.len() { break; }
            let fk = (b[o], u32::from_be_bytes(b[o + 1..o + 5].try_into().unwrap()));
            let (block, need) = (b[o + 5] as usize, b[o + 6] as usize);
            let Some(&pos) = st.index.get(&fk) else { continue };
            let Some(idx) = pos.checked_sub(st.store_base) else { continue };
            let Some((_, s)) = st.store.get_mut(idx) else { continue };
            let header = s.header;
            let blocks: Vec<usize> = if block == 255 { (0..s.blocks.len()).collect() } else { vec![block] };
            for bi in blocks {
                let Some((k, next, shards)) = s.blocks.get_mut(bi) else { continue };
                let k = *k;
                // the whole block lost: k rows; else what's missing plus one spare
                let want = if need >= 255 { k } else { need + 1 };
                let count = want.min(255 - k - (*next).min(255 - k));
                if count == 0 { continue; }
                let refs: Vec<&[u8]> = shards.iter().map(|x| x.as_slice()).collect();
                let rows = fec::parity(&refs, *next, count);
                for (r, sh) in rows.iter().enumerate() {
                    let mut p = Vec::with_capacity(VHDR + SHARD);
                    p.extend_from_slice(&header);
                    p[16] = bi as u8; p[18] = (k + *next + r) as u8; p[19] = k as u8; p[20] = *next as u8;
                    p.extend_from_slice(sh);
                    out.push(p);
                }
                *next += count;
            }
        }
        let mut used = 0.0;
        out.retain(|p| { used += p.len() as f64 + 60.0; used <= budget });
        st.repair_win.1 += used.min(budget.max(0.0));
        st.repaired += out.len() as u32;
        for p in out { st.prio.push_back(p); }
        drop(st);
        self.cv.notify_one();
    }

    // [0x0d][n] n x ([first u32][last u32][count u16][arrival us u32])
    pub fn on_feedback(&self, link: &Link, b: &[u8]) {
        if b.len() < 2 { return; }
        let n = b[1] as usize;
        let now = now_ms();
        let mut g = self.gcc.lock().unwrap();
        let mut prev = self.fb_prev.lock().unwrap();
        let mut wrap = self.arr_wrap.lock().unwrap();
        let ctr_hi = link.ctr.load(std::sync::atomic::Ordering::Relaxed) & !0xffff_ffff;
        let full = |c32: u32| -> u64 { let c = ctr_hi | c32 as u64; if c > link.ctr.load(std::sync::atomic::Ordering::Relaxed) { c.wrapping_sub(1 << 32) } else { c } };
        let (mut expected, mut got) = (0u64, 0u64);
        for e in 0..n {
            let o = 2 + e * 14;
            if o + 14 > b.len() { break; }
            let first = full(u32::from_be_bytes(b[o..o + 4].try_into().unwrap()));
            let last = full(u32::from_be_bytes(b[o + 4..o + 8].try_into().unwrap()));
            let count = u16::from_be_bytes([b[o + 8], b[o + 9]]) as u64;
            let arr32 = u32::from_be_bytes(b[o + 10..o + 14].try_into().unwrap());
            // their microsecond clock, unwrapped
            let d = arr32.wrapping_sub(wrap.0) as i32 as f64 / 1000.0;
            let arr = if wrap.1 == 0.0 { 1.0 } else { wrap.1 + d };
            *wrap = (arr32, arr);
            let from = prev.map(|p| p.0 + 1).unwrap_or(first);
            if last >= from { expected += last - from + 1; got += count; }
            let Some((send_ms, _)) = link.sent_info(last) else { *prev = Some((last, arr)); continue };
            let mut bytes = 0.0;
            let span = last.saturating_sub(first).min(2000);
            for c in last - span..=last { if let Some((_, sz)) = link.sent_info(c) { bytes += sz as f64; } }
            let bytes = if span > 0 { bytes * count as f64 / (span + 1) as f64 } else { bytes };
            g.group(send_ms, arr, now, bytes);
            *prev = Some((last, arr));
        }
        let _ = (expected, got);
        // exact receipts after the groups: mark them, then judge everything sent more than
        // 300 ms ago (anything still missing by then is lost, not just late)
        let mut o = 2 + n * 14;
        let mut gl = self.got.lock().unwrap();
        while o + 6 <= b.len() {
            let base = full(u32::from_be_bytes(b[o..o + 4].try_into().unwrap()));
            let nbits = u16::from_be_bytes([b[o + 4], b[o + 5]]) as usize;
            let bytes = nbits.div_ceil(8);
            if o + 6 + bytes > b.len() { break; }
            for i in 0..nbits { if b[o + 6 + (i >> 3)] & (1 << (i & 7)) != 0 { let c = base + i as u64; gl.0[(c as usize) % 16384] = c; } }
            o += 6 + bytes;
        }
        let top = link.ctr.load(std::sync::atomic::Ordering::Relaxed);
        if gl.1 == u64::MAX { gl.1 = top; }
        let (mut sent_n, mut lost_n) = (0u64, 0u64);
        let mut c = gl.1;
        while c < top && c + 16000 > top {
            match link.sent_info(c) {
                Some((t_send, _)) if now - t_send < 300.0 => break,
                Some(_) => { sent_n += 1; if gl.0[(c as usize) % 16384] != c { lost_n += 1; } }
                None => {}
            }
            c += 1;
        }
        gl.1 = c.max(top.saturating_sub(16000));
        drop(gl);
        let loss = if sent_n > 0 { lost_n as f64 / sent_n as f64 } else { g.loss_ew }; // nothing judged yet: no news
        // what we actually sent lately (to tell "line is full" from "nothing to send")
        let st = self.st.lock().unwrap();
        let span = st.sent_bytes.front().map(|x| now - x.0).unwrap_or(0.0).max(100.0);
        let sent_kbps = st.sent_bytes.iter().map(|x| x.1).sum::<usize>() as f64 * 8.0 / span;
        drop(st);
        g.update(loss, now, sent_kbps);
        let fr = g.fec_ratio();
        drop(g);
        self.st.lock().unwrap().fec_ratio = fr;
    }
}

fn pace(s: Arc<Sender>, link: Weak<Link>) {
    unsafe { use windows::Win32::System::Threading::*; let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL); }
    let sleeper = Sleeper::new();
    loop {
        let Some(l) = link.upgrade() else { return };
        let mut st = s.st.lock().unwrap();
        if st.stop { return; }
        // refill: a film goes at the rate control's estimate; live video gets 10% headroom
        let t = now_ms();
        let rate = st.rate_kbps.max(1000.0) * (if st.keyed { 1.0 } else { 1.1 }) / 8.0; // bytes per ms
        let cap = (16.0 * 1185.0f64).max(rate * 25.0);
        st.tokens = (st.tokens + (t - st.last_refill) * rate).min(cap);
        st.last_refill = t;
        // next body: repairs first, then the queue
        let mut next: Option<(Vec<u8>, bool)> = None;
        if let Some(p) = st.prio.front() {
            if st.tokens >= (p.len() + 60) as f64 { let p = st.prio.pop_front().unwrap(); next = Some((p, false)); }
        } else {
            loop {
                let clock = st.clock;
                let keyed = st.keyed;
                let skip = st.skip_to_key;
                let Some(f) = st.queue.front_mut() else { break };
                if f.i == 0 && keyed && !f.raw {
                    // film frame whose moment on screen is long gone: skip ahead to a keyframe
                    let lateness = clock.map(|(pos, at)| wall_ms() as f64 - (at + (f.pts as f64 - pos))).unwrap_or(f64::MIN);
                    // a frame that lands after its moment is never shown: sending it only steals the
                    // line from the frames still in time (at 1200 ms a joiner sat ~1 s late for 13 s)
                    let late = lateness > 250.0;
                    // a late keyframe too, once a newer one is queued to start from
                    let newer_key = late && f.key && st.queue.iter().skip(1).any(|x| x.key && !x.raw);
                    // ...unless they're what the rest of their GOP decodes from and, sent now, a later
                    // frame of it still lands in time: the viewer decodes through them (a joiner
                    // starting from the keyframe before the picture loses nothing that way)
                    let pays = late && !skip && clock.map(|(pos, at)| {
                        let (now, mut cum) = (wall_ms() as f64, 0.0);
                        for (n, x) in st.queue.iter().enumerate() {
                            if n > 0 && x.key && !x.raw { return false; }
                            cum += x.pkts[x.i..].iter().map(|p| p.len() + 60).sum::<usize>() as f64;
                            if !x.raw && now + cum / rate < at + (x.pts as f64 - pos) - 50.0 { return true; }
                        }
                        false
                    }).unwrap_or(false);
                    let f = st.queue.front_mut().unwrap();
                    if (skip && !f.key) || (late && !f.key && !pays) || (newer_key && !pays) {
                        // dropped on purpose: never offer it as a repair either
                        let fk = f.fk;
                        st.queue.pop_front(); st.skipped += 1; st.skip_to_key = true; st.index.remove(&fk); continue;
                    }
                    if f.key { st.skip_to_key = false; }
                }
                let cost = { let f = st.queue.front().unwrap(); (f.pkts[f.i].len() + 60) as f64 };
                if st.tokens < cost { break; }
                let f = st.queue.front_mut().unwrap();
                let raw = f.raw;
                let body = std::mem::take(&mut f.pkts[f.i]);
                f.i += 1;
                let finished = f.i >= f.pkts.len();
                let (pts, was_raw) = (f.pts, f.raw);
                if finished { st.queue.pop_front(); if !was_raw { st.sent_pts = Some(pts); } }
                next = Some((body, !raw));
                break;
            }
        }
        match next {
            Some((mut body, stamp)) => {
                st.tokens -= (body.len() + 60) as f64;
                let tt = now_ms();
                st.sent_bytes.push_back((tt, body.len() + 60));
                while st.sent_bytes.front().map(|x| tt - x.0 > 500.0).unwrap_or(false) { st.sent_bytes.pop_front(); }
                drop(st);
                // stamp the real departure time: waiting in our own queue isn't network congestion
                if stamp { body[7..11].copy_from_slice(&(wall_ms() as u32).to_be_bytes()); }
                l.send_body(&body);
            }
            None => {
                let empty = st.prio.is_empty() && st.queue.is_empty();
                if empty {
                    let _ = s.cv.wait_timeout(st, std::time::Duration::from_millis(50));
                } else {
                    let need = st.prio.front().map(|p| p.len()).or_else(|| st.queue.front().map(|f| f.pkts[f.i].len())).unwrap_or(1185) as f64 + 60.0;
                    let wait_us = (((need - st.tokens) / rate) * 1000.0).max(200.0) as u64;
                    drop(st);
                    let _ = now_us();
                    sleeper.sleep_us(wait_us.min(20_000));
                }
            }
        }
    }
}
