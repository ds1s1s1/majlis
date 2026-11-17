// Test aid: an emulated bottleneck on the host's outgoing packets, set by the environment:
//   MAJLIS_NETEM=kbps,delay_ms,jitter_ms,buffer_ms,loss_pct   e.g. 3000,35,0,600,0
// Rate-limited queue with drop-tail at buffer_ms, fixed delay plus in-order random jitter, random loss.
// Everything the host sends natively goes through it (video, repairs, JS packets on native
// routes), so a test sees one honest queue.
use crate::link::{transmit, Ev, Route};
use crate::sock::links;
use crate::time::{now_us, Sleeper};
use std::collections::BinaryHeap;
use std::cmp::Reverse;
use std::sync::{Condvar, Mutex, OnceLock};

struct Cfg { kbps: f64, delay_us: f64, jitter_us: f64, buf_us: f64, loss: f64 }
struct Item(u64, u64, u32, Route, Vec<u8>); // release us, seq, sid, route, packet
impl PartialEq for Item { fn eq(&self, o: &Self) -> bool { self.0 == o.0 && self.1 == o.1 } }
impl Eq for Item {}
impl PartialOrd for Item { fn partial_cmp(&self, o: &Self) -> Option<std::cmp::Ordering> { Some(self.cmp(o)) } }
impl Ord for Item { fn cmp(&self, o: &Self) -> std::cmp::Ordering { (self.0, self.1).cmp(&(o.0, o.1)) } }

struct Q { heap: BinaryHeap<Reverse<Item>>, busy_until: f64, seq: u64, rnd: u64, last_at: u64 }

fn cfg() -> &'static Option<Cfg> {
    static C: OnceLock<Option<Cfg>> = OnceLock::new();
    C.get_or_init(|| {
        let v = std::env::var("MAJLIS_NETEM").ok()?;
        let p: Vec<f64> = v.split(',').map(|x| x.trim().parse().unwrap_or(0.0)).collect();
        let g = |i: usize, d: f64| p.get(i).copied().unwrap_or(d);
        Some(Cfg { kbps: g(0, 6000.0), delay_us: g(1, 35.0) * 1000.0, jitter_us: g(2, 0.0) * 1000.0, buf_us: g(3, 600.0) * 1000.0, loss: g(4, 0.0) / 100.0 })
    })
}

fn q() -> &'static (Mutex<Q>, Condvar) {
    static Q_: OnceLock<(Mutex<Q>, Condvar)> = OnceLock::new();
    Q_.get_or_init(|| {
        std::thread::spawn(|| {
            let s = Sleeper::new();
            loop {
                let (m, cv) = q();
                let mut g = m.lock().unwrap();
                let t = now_us();
                match g.heap.peek().map(|r| r.0 .0) {
                    None => { let _ = cv.wait_timeout(g, std::time::Duration::from_millis(20)); }
                    Some(at) if at > t => { drop(g); s.sleep_us((at - t).min(5000)); }
                    Some(_) => {
                        let Reverse(Item(_, _, sid, route, pkt)) = g.heap.pop().unwrap();
                        drop(g);
                        if let Some(l) = links().read().unwrap().get(&sid).and_then(|v| v.first().cloned()) { transmit(&l.cb, &route, pkt); }
                    }
                }
            }
        });
        (Mutex::new(Q { heap: BinaryHeap::new(), busy_until: 0.0, seq: 0, rnd: 0x9e3779b97f4a7c15, last_at: 0 }), Condvar::new())
    })
}

// Some(sent) if the emulator took the packet, None if it's off
pub fn offer(sid: u32, route: &Route, pkt: &[u8]) -> Option<bool> {
    let c = cfg().as_ref()?;
    let _ = std::marker::PhantomData::<Ev>;
    let (m, cv) = q();
    let mut g = m.lock().unwrap();
    g.rnd ^= g.rnd << 13; g.rnd ^= g.rnd >> 7; g.rnd ^= g.rnd << 17;
    let r1 = (g.rnd % 1_000_000) as f64 / 1_000_000.0;
    g.rnd ^= g.rnd << 13; g.rnd ^= g.rnd >> 7; g.rnd ^= g.rnd << 17;
    let r2 = (g.rnd % 1_000_000) as f64 / 1_000_000.0;
    let t = now_us() as f64;
    let start = t.max(g.busy_until);
    if start - t > c.buf_us { return Some(false); } // buffer full: drop
    g.busy_until = start + (pkt.len() + 28) as f64 * 8.0 / c.kbps * 1000.0;
    if r1 < c.loss { return Some(false); }
    // jitter keeps order, as on a radio link: a held-back packet holds up the ones behind it,
    // which then land together (per-packet random delays would reorder everything)
    let at = ((g.busy_until + c.delay_us + r2 * c.jitter_us) as u64).max(g.last_at);
    g.last_at = at;
    g.seq += 1;
    let seq = g.seq;
    g.heap.push(Reverse(Item(at, seq, sid, route.clone(), pkt.to_vec())));
    drop(g);
    cv.notify_one();
    Some(true)
}
