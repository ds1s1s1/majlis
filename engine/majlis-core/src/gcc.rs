// Rate control from per-packet feedback (the approach WebRTC's GCC uses):
//  - the receiver reports, for groups of packets, when the last one arrived;
//  - we know when each one left, so the change in one-way delay between groups is exact
//    (no clock sync needed); a trendline over the last groups says whether queues are
//    building (overuse), draining (underuse) or steady;
//  - loss comes from the counters (every sealed packet, not just video);
//  - AIMD on top: overuse -> 85% of what actually got through; steady -> grow (fast while far
//    from the last trouble, gently near it); while the sender isn't using what it has
//    (still screen, full film buffer), hold instead of growing.
use std::collections::VecDeque;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Signal { Normal, Over, Under }

pub struct Gcc {
    pub target: f64,  // kbps
    pub min: f64,
    pub max: f64,
    pub loss_ew: f64,
    pub congestions: u32,
    pub last_drop_ms: f64,
    pub signal: Signal,
    pub acked_kbps: f64,
    pub trend: f64,
    // trendline
    acc: f64,
    smooth: f64,
    hist: VecDeque<(f64, f64)>,
    first_arr: Option<f64>,
    prev: Option<(f64, f64)>, // (send ms, arrival ms) of the previous group
    gamma: f64,
    over_ms: f64,
    prev_trend: f64,
    last_update_ms: f64,
    last_change_ms: f64,
    drop_rate: Option<f64>, // acked rate when we last backed off
    acked: VecDeque<(f64, f64)>, // (time ms, bytes)
    pub stability: bool,
    deltas: u32,
}

impl Gcc {
    pub fn new(start: f64, min: f64, max: f64) -> Gcc {
        Gcc {
            target: start.clamp(min, max), min, max, loss_ew: 0.0, congestions: 0, last_drop_ms: 0.0, signal: Signal::Normal, acked_kbps: 0.0, trend: 0.0,
            acc: 0.0, smooth: 0.0, hist: VecDeque::new(), first_arr: None, prev: None, gamma: 12.5, over_ms: 0.0, prev_trend: 0.0,
            last_update_ms: 0.0, last_change_ms: 0.0, drop_rate: None, acked: VecDeque::new(), stability: false, deltas: 0,
        }
    }

    // one packet group: when it left (our clock), when it landed (theirs), bytes in it
    pub fn group(&mut self, send_ms: f64, arr_ms: f64, now_ms: f64, bytes: f64) {
        self.acked.push_back((now_ms, bytes));
        if let Some((ps, pa)) = self.prev {
            let d = (arr_ms - pa) - (send_ms - ps);
            // ignore reordering and clock jumps
            if d.abs() < 1000.0 && arr_ms >= pa {
                self.acc += d;
                self.smooth = 0.9 * self.smooth + 0.1 * self.acc;
                let first = *self.first_arr.get_or_insert(arr_ms);
                self.hist.push_back((arr_ms - first, self.smooth));
                self.deltas = (self.deltas + 1).min(1000);
                while self.hist.len() > 20 { self.hist.pop_front(); }
                if self.hist.len() >= 5 {
                    let n = self.hist.len() as f64;
                    let mx = self.hist.iter().map(|p| p.0).sum::<f64>() / n;
                    let my = self.hist.iter().map(|p| p.1).sum::<f64>() / n;
                    let (mut num, mut den) = (0.0, 0.0);
                    for (x, y) in &self.hist { num += (x - mx) * (y - my); den += (x - mx) * (x - mx); }
                    let slope = if den > 0.0 { num / den } else { 0.0 };
                    // gain as in WebRTC: min(deltas seen, 60) x 4, so a few percent of overload
                    // (a queue growing slowly) already stands out from the noise
                    let trend = slope * (self.deltas as f64).min(60.0) * 4.0;
                    let dt = (now_ms - self.last_update_ms).clamp(0.0, 100.0);
                    // adaptive threshold: follows the noise of this line, slowly upwards, fast down
                    let k = if trend.abs() < self.gamma { 0.039 } else { 0.0087 };
                    if trend.abs() < self.gamma + 15.0 { self.gamma += k * (trend.abs() - self.gamma) * dt; }
                    self.gamma = self.gamma.clamp(6.0, 600.0);
                    self.signal = if trend > self.gamma {
                        self.over_ms += dt;
                        if self.over_ms > 10.0 && trend >= self.prev_trend { Signal::Over } else { self.signal }
                    } else {
                        self.over_ms = 0.0;
                        if trend < -self.gamma { Signal::Under } else { Signal::Normal }
                    };
                    self.prev_trend = trend;
                    self.trend = trend;
                }
            }
        }
        self.prev = Some((send_ms, arr_ms));
        self.last_update_ms = now_ms;
    }

    // after each feedback: loss over that feedback, now
    pub fn update(&mut self, loss: f64, now_ms: f64, app_limited_kbps: f64) {
        self.loss_ew = self.loss_ew * 0.85 + loss * 0.15;
        while self.acked.len() > 1 && now_ms - self.acked.front().unwrap().0 > 500.0 { self.acked.pop_front(); }
        let span = (now_ms - self.acked.front().map(|a| a.0).unwrap_or(now_ms)).max(100.0);
        self.acked_kbps = self.acked.iter().map(|a| a.1).sum::<f64>() * 8.0 / span;
        let dt = (now_ms - self.last_change_ms).clamp(0.0, 1000.0) / 1000.0;
        self.last_change_ms = now_ms;
        // loss decides on its average (one 50 ms report is too few packets to mean much);
        // FEC and repairs cover a few percent, so only real, sustained loss backs off
        let lthr = if self.stability { 0.06 } else { 0.10 };
        let lossy = self.loss_ew > lthr;
        if (self.signal == Signal::Over || lossy) && now_ms - self.last_drop_ms > 300.0 {
            let base = if self.acked_kbps > self.target * 0.5 { self.acked_kbps } else { self.target };
            let mut next = base * 0.85;
            if lossy { next = next.min(self.target * (1.0 - 0.5 * self.loss_ew)); }
            self.target = next.clamp(self.min, self.max);
            self.drop_rate = Some(self.acked_kbps.max(self.target));
            self.last_drop_ms = now_ms;
            self.congestions += 1;
            self.signal = Signal::Normal;
            self.over_ms = 0.0;
            return;
        }
        // draining, or losing more than FEC + repairs comfortably cover: hold
        if self.signal == Signal::Under || self.loss_ew > 0.05 { return; }
        // not using what we have (still picture, film buffer full): don't climb on nothing
        let used = app_limited_kbps.max(self.acked_kbps);
        if used < self.target * 0.5 { return; }
        let hold = if self.stability { 3000.0 } else { 1500.0 };
        if now_ms - self.last_drop_ms < hold { return; }
        let near = self.drop_rate.map(|r| self.target > r * 0.8 && self.target < r * 1.2).unwrap_or(false);
        // ~16%/s away from trouble (8% in stability mode), ~3%/s close to where it last struck
        let grow = if near { 1.0 + 0.03 * dt } else { (if self.stability { 1.04f64 } else { 1.08f64 }).powf(dt * 2.0) };
        self.target = (self.target * grow).clamp(self.min, self.max);
    }

    pub fn fec_ratio(&self) -> f64 {
        (self.loss_ew * 2.5 + if self.stability { 0.06 } else { 0.03 }).clamp(if self.stability { 0.1 } else { 0.05 }, 0.5)
    }
}
