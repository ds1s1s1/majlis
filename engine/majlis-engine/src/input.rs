// Keyboard and mouse injection. Keys go in as scan codes, so games that read raw input or
// DirectInput see them the same as a real keyboard. Everything held is remembered so the
// panic button (or a guest leaving) can let go of all of it.
use serde_json::Value;
use std::collections::HashSet;
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN};

pub struct Input {
    rect: (i32, i32, i32, i32),
    keys: HashSet<(u16, bool)>,
    buttons: HashSet<i64>,
}

fn mouse(dx: i32, dy: i32, flags: MOUSE_EVENT_FLAGS, data: i32) -> INPUT {
    INPUT { r#type: INPUT_MOUSE, Anonymous: INPUT_0 { mi: MOUSEINPUT { dx, dy, mouseData: data as u32, dwFlags: flags, time: 0, dwExtraInfo: 0 } } }
}

fn key(sc: u16, ext: bool, down: bool) -> INPUT {
    let mut f = KEYEVENTF_SCANCODE;
    if ext { f |= KEYEVENTF_EXTENDEDKEY; }
    if !down { f |= KEYEVENTF_KEYUP; }
    INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(0), wScan: sc, dwFlags: f, time: 0, dwExtraInfo: 0 } } }
}

fn button(b: i64, down: bool) -> INPUT {
    let (f, data) = match b {
        0 => (if down { MOUSEEVENTF_LEFTDOWN } else { MOUSEEVENTF_LEFTUP }, 0),
        1 => (if down { MOUSEEVENTF_MIDDLEDOWN } else { MOUSEEVENTF_MIDDLEUP }, 0),
        2 => (if down { MOUSEEVENTF_RIGHTDOWN } else { MOUSEEVENTF_RIGHTUP }, 0),
        3 => (if down { MOUSEEVENTF_XDOWN } else { MOUSEEVENTF_XUP }, 1),
        _ => (if down { MOUSEEVENTF_XDOWN } else { MOUSEEVENTF_XUP }, 2),
    };
    mouse(0, 0, f, data)
}

impl Input {
    pub fn new() -> Input { Input { rect: (0, 0, 1920, 1080), keys: HashSet::new(), buttons: HashSet::new() } }

    pub fn set_rect(&mut self, x: i32, y: i32, w: i32, h: i32) { self.rect = (x, y, w.max(1), h.max(1)); }

    // events: [[1,down,sc,ext], [2,dx,dy], [3,x,y 0..65535], [4,btn,down], [5,dy,dx]]
    pub fn apply(&mut self, events: &[Value]) {
        let mut list = Vec::with_capacity(events.len());
        let n = |a: &Vec<Value>, i: usize| a.get(i).and_then(|v| v.as_i64()).unwrap_or(0);
        for e in events {
            let Some(a) = e.as_array() else { continue };
            match n(a, 0) {
                1 => {
                    let (down, sc, ext) = (n(a, 1) != 0, n(a, 2) as u16, n(a, 3) != 0);
                    if down { self.keys.insert((sc, ext)); } else { self.keys.remove(&(sc, ext)); }
                    list.push(key(sc, ext, down));
                }
                2 => list.push(mouse(n(a, 1) as i32, n(a, 2) as i32, MOUSEEVENTF_MOVE, 0)),
                3 => {
                    let (nx, ny) = (n(a, 1) as f64 / 65535.0, n(a, 2) as f64 / 65535.0);
                    let (vx, vy, vw, vh) = unsafe { (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN), GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN)) };
                    let (rx, ry, rw, rh) = self.rect;
                    let px = rx as f64 + nx * (rw - 1) as f64;
                    let py = ry as f64 + ny * (rh - 1) as f64;
                    let ax = ((px - vx as f64) * 65535.0 / (vw - 1).max(1) as f64).round() as i32;
                    let ay = ((py - vy as f64) * 65535.0 / (vh - 1).max(1) as f64).round() as i32;
                    list.push(mouse(ax, ay, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, 0));
                }
                4 => {
                    let (b, down) = (n(a, 1), n(a, 2) != 0);
                    if down { self.buttons.insert(b); } else { self.buttons.remove(&b); }
                    list.push(button(b, down));
                }
                5 => {
                    let (dy, dx) = (n(a, 1) as i32, n(a, 2) as i32);
                    if dy != 0 { list.push(mouse(0, 0, MOUSEEVENTF_WHEEL, dy)); }
                    if dx != 0 { list.push(mouse(0, 0, MOUSEEVENTF_HWHEEL, dx)); }
                }
                _ => {}
            }
        }
        if !list.is_empty() { unsafe { SendInput(&list, std::mem::size_of::<INPUT>() as i32); } }
    }

    pub fn release_all(&mut self) {
        let mut list: Vec<INPUT> = self.keys.iter().map(|&(sc, ext)| key(sc, ext, false)).collect();
        list.extend(self.buttons.iter().map(|&b| button(b, false)));
        self.keys.clear(); self.buttons.clear();
        if !list.is_empty() { unsafe { SendInput(&list, std::mem::size_of::<INPUT>() as i32); } }
    }
}
