use std::sync::OnceLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

fn base() -> Instant { static B: OnceLock<Instant> = OnceLock::new(); *B.get_or_init(Instant::now) }

// monotonic, microseconds
pub fn now_us() -> u64 { base().elapsed().as_micros() as u64 }
pub fn now_ms() -> f64 { now_us() as f64 / 1000.0 }
// wall clock in ms (what Date.now() says on the other side)
pub fn wall_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }

// Sleep with sub-millisecond precision: a high-resolution waitable timer (Windows 10 1803+).
// Plain sleep() is 1-15 ms, too coarse to pace packets; spinning would burn a core. The pacer
// sends whatever its token bucket allows each time it wakes, so ~0.5 ms accuracy is plenty.
pub struct Sleeper(windows::Win32::Foundation::HANDLE);
unsafe impl Send for Sleeper {}

impl Sleeper {
    pub fn new() -> Sleeper {
        use windows::Win32::System::Threading::*;
        let h = unsafe { CreateWaitableTimerExW(None, None, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS.0) }.unwrap_or_default();
        Sleeper(h)
    }
    pub fn sleep_us(&self, us: u64) {
        use windows::Win32::System::Threading::*;
        if us < 150 { return; }
        if self.0.is_invalid() { std::thread::sleep(std::time::Duration::from_micros(us)); return; }
        let due = -((us as i64) * 10); // relative, 100 ns units
        unsafe { if SetWaitableTimer(self.0, &due, 0, None, None, false).is_ok() { WaitForSingleObject(self.0, 100); } }
    }
}

impl Drop for Sleeper {
    fn drop(&mut self) { unsafe { let _ = windows::Win32::Foundation::CloseHandle(self.0); } }
}
