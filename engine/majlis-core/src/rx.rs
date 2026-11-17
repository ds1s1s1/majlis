// Video receive side (same logic and wire format as VideoRx in media.js): shards -> blocks ->
// Reed-Solomon -> whole frames for the decoder, plus the numbers the sender adapts to.
// New here: NACK. For films and spectators (who have time to spare), a block that's still
// short of shards a moment after its frame stopped arriving asks for exactly the shards it
// lacks; the sender answers with fresh parity rows, so any of them fills any hole.
use crate::fec;
use crate::link::Ev;
use crate::time::{now_us, wall_ms};
use std::collections::{HashMap, HashSet, VecDeque};

pub const SHARD: usize = 1100;
pub const VHDR: usize = 25;

struct Block { k: usize, sh: HashMap<usize, Vec<u8>>, ok: bool, data: Option<Vec<Vec<u8>>>, nacks: u32, last_nack_us: u64 }
struct Frame { epoch: u8, id: u32, key: bool, host_ts: u32, enc_ms: u8, len: usize, pts: u32, blocks: Vec<Option<Block>>, done: usize, first_us: u64, first_wall: u64, last_us: u64 }

pub struct Receiver {
    frames: HashMap<(u8, u32), Frame>,
    done: HashSet<(u8, u32)>,
    done_order: VecDeque<(u8, u32)>,
    last_delivered: i64,
    last_epoch: i32,
    wait_key: bool,
    pub film: bool,
    pub nack: bool,
    pub rtt_ms: f64,
    // report window
    bytes: u64, frames_n: u32, lost: u32, recovered: u32, nacked: u32, t0: u64,
    pub lost_ids: Vec<u32>,
    owd_base: VecDeque<(i64, u64)>,
    qd: Vec<f64>, gaps: Vec<f64>, last_arrival: u64,
    jitter_ms: f64,
    // film/spectator: frames we never saw a single shard of (a gap in the ids)
    missing: HashMap<(u8, u32), (u64, u32, u64)>,
    seen_max: HashMap<u8, u32>,
}

impl Receiver {
    pub fn new() -> Receiver {
        Receiver {
            frames: HashMap::new(), done: HashSet::new(), done_order: VecDeque::new(), last_delivered: -1, last_epoch: -1, wait_key: true,
            film: false, nack: false, rtt_ms: 50.0, bytes: 0, frames_n: 0, lost: 0, recovered: 0, nacked: 0, t0: now_us(), lost_ids: vec![],
            owd_base: VecDeque::new(), qd: vec![], gaps: vec![], last_arrival: 0, jitter_ms: 0.0,
            missing: HashMap::new(), seen_max: HashMap::new(),
        }
    }

    pub fn count(&mut self, bytes: usize) { self.bytes += bytes as u64 + 29; }

    pub fn push(&mut self, b: &[u8], wire: usize) -> Vec<Ev> {
        self.bytes += wire as u64 + 29;
        if b.len() < VHDR + SHARD { return vec![]; }
        let epoch = b[1];
        let id = u32::from_be_bytes(b[2..6].try_into().unwrap());
        let key = b[6] & 1 != 0;
        let fk = (epoch, id);
        if self.film {
            if self.done.contains(&fk) { return vec![]; }
        } else {
            if epoch as i32 != self.last_epoch && self.last_epoch != -1 && !key && self.wait_key { return vec![]; }
            if self.last_delivered >= 0 && epoch as i32 == self.last_epoch && (id.wrapping_sub(self.last_delivered as u32) as i32) <= 0 { return vec![]; }
        }
        let t = now_us();
        if self.nack && !self.frames.contains_key(&fk) {
            self.missing.remove(&fk);
            let m = self.seen_max.entry(epoch).or_insert(id.wrapping_sub(1));
            let gap = id.wrapping_sub(*m) as i32;
            if gap > 1 && gap < 64 { for x in 1..gap as u32 { self.missing.insert((epoch, m.wrapping_add(x)), (t, 0, 0)); } }
            if gap > 0 { *m = id; }
        }
        let f = self.frames.entry(fk).or_insert_with(|| Frame {
            epoch, id, key, host_ts: u32::from_be_bytes(b[7..11].try_into().unwrap()), enc_ms: b[11], len: u32::from_be_bytes(b[12..16].try_into().unwrap()) as usize,
            pts: u32::from_be_bytes(b[21..25].try_into().unwrap()), blocks: (0..b[17]).map(|_| None).collect(), done: 0, first_us: t, first_wall: wall_ms(), last_us: t,
        });
        f.last_us = t;
        let (bi, si, k) = (b[16] as usize, b[18] as usize, b[19] as usize);
        if bi >= f.blocks.len() || k == 0 { return vec![]; }
        let blk = f.blocks[bi].get_or_insert_with(|| Block { k, sh: HashMap::new(), ok: false, data: None, nacks: 0, last_nack_us: 0 });
        if blk.ok || blk.sh.contains_key(&si) { return vec![]; }
        blk.sh.insert(si, b[VHDR..VHDR + SHARD].to_vec());
        if blk.sh.len() >= blk.k {
            let data_missing = (0..blk.k).any(|j| !blk.sh.contains_key(&j));
            let mut list: Vec<(usize, &[u8])> = blk.sh.iter().map(|(i, v)| (*i, v.as_slice())).collect();
            list.sort_by_key(|x| x.0);
            let Some(out) = fec::decode(&list, blk.k) else { return vec![] };
            if data_missing { self.recovered += 1; }
            blk.data = Some(out); blk.ok = true; blk.sh.clear();
            f.done += 1;
            if f.done == f.blocks.len() { return self.complete(fk); }
        }
        vec![]
    }

    fn complete(&mut self, fk: (u8, u32)) -> Vec<Ev> {
        let f = self.frames.remove(&fk).unwrap();
        let mut data = Vec::with_capacity(f.len);
        'outer: for blk in f.blocks.iter().flatten() {
            for s in blk.data.as_ref().unwrap() {
                let n = SHARD.min(f.len - data.len());
                if n == 0 { break 'outer; }
                data.extend_from_slice(&s[..n]);
            }
        }
        if self.film {
            self.done.insert(fk); self.done_order.push_back(fk);
            while self.done_order.len() > 3000 { let o = self.done_order.pop_front().unwrap(); self.done.remove(&o); }
        } else {
            // live: anything older that never finished is lost (waiting would add delay)
            let older: Vec<(u8, u32)> = self.frames.keys().filter(|(e, i)| *e == f.epoch && (i.wrapping_sub(f.id) as i32) < 0).cloned().collect();
            for o in older { self.frames.remove(&o); self.lost += 1; self.lost_ids.push(o.1); }
        }
        let gap = if self.last_epoch == f.epoch as i32 && self.last_delivered >= 0 { (f.id.wrapping_sub(self.last_delivered as u32) as i32) - 1 } else { 0 };
        self.frames_n += 1;
        if f.key { self.wait_key = false; }
        if !self.film && f.epoch as i32 != self.last_epoch && !f.key { self.wait_key = true; return vec![]; }
        self.last_epoch = f.epoch as i32;
        self.last_delivered = if self.film { self.last_delivered.max(f.id as i64) } else { f.id as i64 };
        // queuing delay from the first shard (the frame's own size doesn't delay that one),
        // against the quietest the line has been over 30 s
        let t = now_us();
        let owd = (f.first_wall as u32).wrapping_sub(f.host_ts) as i32 as i64;
        self.owd_base.push_back((owd, t));
        while self.owd_base.len() > 1 && t - self.owd_base.front().unwrap().1 > 30_000_000 { self.owd_base.pop_front(); }
        let base = self.owd_base.iter().map(|x| x.0).min().unwrap_or(owd);
        if !f.key { self.qd.push((owd - base) as f64); }
        if self.last_arrival > 0 { self.gaps.push((t - self.last_arrival) as f64 / 1000.0); }
        self.last_arrival = t;
        let mut meta = [0u8; 24];
        meta[0] = f.epoch; meta[1] = f.key as u8;
        meta[2..4].copy_from_slice(&(gap.clamp(-32768, 32767) as i16).to_be_bytes());
        meta[4..8].copy_from_slice(&f.id.to_be_bytes());
        meta[8..12].copy_from_slice(&f.host_ts.to_be_bytes());
        meta[12] = f.enc_ms;
        meta[16..20].copy_from_slice(&f.pts.to_be_bytes());
        meta[20..24].copy_from_slice(&(owd as i32).to_be_bytes());
        vec![Ev::Frame { meta, data }]
    }

    // housekeeping (every ~10 ms): time out dead frames, and build a NACK for blocks that
    // stopped short. [0x0e][n u8] n x ([epoch u8][id u32][block u8][need u8])
    pub fn tick(&mut self) -> Option<Vec<u8>> {
        let t = now_us();
        let tmo = if self.film { 2_000_000 } else { 250_000 };
        let dead: Vec<(u8, u32)> = self.frames.iter().filter(|(_, f)| t - f.first_us > tmo).map(|(k, _)| *k).collect();
        for k in dead { self.frames.remove(&k); self.lost += 1; if !self.film { self.lost_ids.push(k.1); } }
        if !self.nack { return None; }
        // a frame is "stalled" once nothing came for a bit longer than the line's wobble
        let wait = (self.jitter_ms * 2.0).clamp(15.0, 80.0) * 1000.0;
        let again = (self.rtt_ms * 1.3 + 15.0) * 1000.0;
        let mut out = vec![0x0e, 0];
        let mut n = 0u8;
        for f in self.frames.values_mut() {
            if (t - f.last_us) as f64 <= wait { continue; }
            for (bi, b) in f.blocks.iter_mut().enumerate() {
                let need = match b { None => 0, Some(b) if b.ok => 0, Some(b) => b.k.saturating_sub(b.sh.len()) };
                // a block we got nothing of at all: we don't know its size; ask for the whole thing
                let (need, b) = match b { None => (255usize, None), Some(b) => (need, Some(b)) };
                if need == 0 { continue; }
                if let Some(b) = &b { if b.nacks >= 4 || ((t - b.last_nack_us) as f64) < again { continue; } }
                if n >= 150 { break; }
                out.push(f.epoch); out.extend_from_slice(&f.id.to_be_bytes()); out.push(bi as u8); out.push(need.min(255) as u8);
                n += 1;
                if let Some(b) = b { b.nacks += 1; b.last_nack_us = t; }
            }
        }
        // whole frames that never showed up: ask for all of it (block 255)
        let mut gone = vec![];
        for (k, m) in self.missing.iter_mut() {
            if t - m.0 > 2_000_000 || m.1 >= 4 { gone.push(*k); continue; }
            if ((t - m.0) as f64) < wait || ((t - m.2) as f64) < again || n >= 150 { continue; }
            out.push(k.0); out.extend_from_slice(&k.1.to_be_bytes()); out.push(255); out.push(255);
            n += 1; m.1 += 1; m.2 = t;
        }
        for k in gone { self.missing.remove(&k); }
        if n == 0 { return None; }
        self.nacked += n as u32;
        out[1] = n;
        Some(out)
    }

    pub fn report(&mut self) -> String {
        let t = now_us();
        let dt = ((t - self.t0) as f64 / 1000.0).max(1.0);
        let qd = if self.qd.is_empty() { 0.0 } else { self.qd.iter().sum::<f64>() / self.qd.len() as f64 };
        let jit = if self.gaps.len() > 2 {
            let m = self.gaps.iter().sum::<f64>() / self.gaps.len() as f64;
            self.gaps.iter().map(|g| (g - m).abs()).sum::<f64>() / self.gaps.len() as f64
        } else { 0.0 };
        self.jitter_ms = self.jitter_ms * 0.8 + jit * 0.2;
        let ids: Vec<String> = self.lost_ids.iter().rev().take(32).map(|x| x.to_string()).collect();
        let r = format!(
            "{{\"kbps\":{},\"loss\":0,\"lost\":{},\"recovered\":{},\"nacked\":{},\"frames\":{},\"qd\":{:.1},\"jitter\":{:.1},\"fps\":{}{}}}",
            (self.bytes as f64 * 8.0 / dt).round(), self.lost, self.recovered, self.nacked, self.frames_n, qd, jit, (self.frames_n as f64 * 1000.0 / dt).round(),
            if ids.is_empty() { String::new() } else { format!(",\"lostIds\":[{}]", ids.join(",")) }
        );
        self.bytes = 0; self.frames_n = 0; self.lost = 0; self.recovered = 0; self.nacked = 0; self.t0 = t;
        self.qd.clear(); self.gaps.clear(); self.lost_ids.clear();
        r
    }
}
