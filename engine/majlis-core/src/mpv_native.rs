#![allow(non_camel_case_types, clippy::too_many_arguments)]
// Harbor-grade native Windows D3D11/gpu-next libmpv player for Majlis Theater mode.
// Renders hardware-accelerated video directly into an owned native Win32 HWND (`MajlisVideoHost`)
// with a transparent HUD BrowserWindow atomically synced directly above it via DeferWindowPos,
// plus Harbor's minimize swapchain size-guard, WASAPI post-pause stall recovery, and native drag.
use libloading::Library;
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{Env, JsFunction};
use napi_derive::napi;
use serde_json::{json, Value};
use std::ffi::{c_void, CStr, CString};
use std::os::raw::{c_char, c_double, c_int, c_ulonglong};
use std::ptr::null;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Instant;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{ClientToScreen, GetStockObject, BLACK_BRUSH, HBRUSH};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::ReleaseCapture;
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    BeginDeferWindowPos, CreateWindowExW, DeferWindowPos, DefWindowProcW, DestroyWindow,
    DispatchMessageW, EndDeferWindowPos, GetClientRect, GetCursorPos, GetMessageW, GetWindow,
    GetWindowLongW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, PostMessageW,
    PostQuitMessage, RegisterClassW, SetForegroundWindow, SetWindowPos, SetWindowTextW,
    TranslateMessage, GWL_EXSTYLE, GW_HWNDPREV, HTCAPTION, HWND_NOTOPMOST, HWND_TOP, HWND_TOPMOST,
    MSG, SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, WM_ACTIVATE,
    WM_APP, WM_DESTROY, WM_EXITSIZEMOVE, WM_MOUSEACTIVATE, WM_MOVE, WM_NCLBUTTONDOWN,
    WM_SHOWWINDOW, WM_SIZE, WM_WINDOWPOSCHANGED, WNDCLASSW, WS_CLIPSIBLINGS, WS_EX_NOACTIVATE,
    WS_EX_TOPMOST, WS_POPUP,
};

#[link(name = "winmm")]
extern "system" {
    fn timeBeginPeriod(uPeriod: u32) -> u32;
    fn timeEndPeriod(uPeriod: u32) -> u32;
}

struct TimerPeriodGuard(u32);
impl TimerPeriodGuard {
    fn new(ms: u32) -> Self {
        unsafe { timeBeginPeriod(ms); }
        Self(ms)
    }
}
impl Drop for TimerPeriodGuard {
    fn drop(&mut self) {
        unsafe { timeEndPeriod(self.0); }
    }
}

// ------------------------------------------------------------------ Win32 Window Constants & Sync
const MAJLIS_SUBCLASS_ID: usize = 0x4D4A5342;
const MAJLIS_SIZE_GUARD_ID: usize = 0x4D4A5347;
const WM_APP_DESTROY_HOST: u32 = WM_APP + 41;
const MA_NOACTIVATE: isize = 3;
const MIN_EMBED_CLIENT: i32 = 64;

#[repr(C)]
struct WindowPos {
    hwnd: HWND,
    hwnd_insert_after: HWND,
    x: i32,
    y: i32,
    cx: i32,
    cy: i32,
    flags: u32,
}

#[derive(Clone, Copy, Default)]
struct SyncState {
    main_hwnd: isize,
    hud_hwnd: isize,
    video_hwnd: isize,
    visible: bool,
    video_visible: bool,
    inset_top: i32,
    inset_right: i32,
    inset_bottom: i32,
    inset_left: i32,
}

static SYNC_REG: Mutex<Vec<(usize, SyncState)>> = Mutex::new(Vec::new());
static NEXT_TOKEN: AtomicUsize = AtomicUsize::new(1);

fn register_sync_state(token: usize, st: SyncState) {
    if let Ok(mut reg) = SYNC_REG.lock() {
        if let Some(entry) = reg.iter_mut().find(|(t, _)| *t == token) {
            entry.1 = st;
        } else {
            reg.push((token, st));
        }
    }
}

fn unregister_sync_state(token: usize) {
    if let Ok(mut reg) = SYNC_REG.lock() {
        reg.retain(|(t, _)| *t != token);
    }
}

fn get_sync_state(token: usize) -> Option<SyncState> {
    SYNC_REG
        .lock()
        .ok()
        .and_then(|reg| reg.iter().find(|(t, _)| *t == token).map(|(_, s)| *s))
}

unsafe fn sync_layout_now(st: SyncState) {
    if st.video_hwnd == 0 {
        return;
    }
    let video = HWND(st.video_hwnd as *mut _);
    if !IsWindow(Some(video)).as_bool() {
        return;
    }
    let hud = if st.hud_hwnd != 0 && IsWindow(Some(HWND(st.hud_hwnd as *mut _))).as_bool() {
        Some(HWND(st.hud_hwnd as *mut _))
    } else {
        None
    };

    if !st.visible || st.main_hwnd == 0 {
        let _ = SetWindowPos(
            video,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_HIDEWINDOW,
        );
        if let Some(h) = hud {
            let _ = SetWindowPos(
                h,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_HIDEWINDOW,
            );
        }
        return;
    }

    let main = HWND(st.main_hwnd as *mut _);
    if !IsWindow(Some(main)).as_bool() || IsIconic(main).as_bool() || !IsWindowVisible(main).as_bool() {
        let _ = SetWindowPos(
            video,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_HIDEWINDOW,
        );
        if let Some(h) = hud {
            let _ = SetWindowPos(
                h,
                None,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_HIDEWINDOW,
            );
        }
        return;
    }

    let mut rc = RECT::default();
    if GetClientRect(main, &mut rc).is_err() {
        return;
    }
    let w = (rc.right - rc.left).max(0);
    let h = (rc.bottom - rc.top).max(0);
    if w < MIN_EMBED_CLIENT || h < MIN_EMBED_CLIENT {
        return;
    }
    let mut pt = POINT { x: rc.left, y: rc.top };
    let _ = ClientToScreen(main, &mut pt);

    let main_topmost = (GetWindowLongW(main, GWL_EXSTYLE) & (WS_EX_TOPMOST.0 as i32)) != 0;
    if !main_topmost {
        if let Some(h) = hud {
            if (GetWindowLongW(h, GWL_EXSTYLE) & (WS_EX_TOPMOST.0 as i32)) != 0 {
                let _ = SetWindowPos(h, Some(HWND_NOTOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            }
        }
        if (GetWindowLongW(video, GWL_EXSTYLE) & (WS_EX_TOPMOST.0 as i32)) != 0 {
            let _ = SetWindowPos(video, Some(HWND_NOTOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }

    let vx = pt.x + st.inset_left;
    let vy = pt.y + st.inset_top;
    let vw = (w - st.inset_left - st.inset_right).max(MIN_EMBED_CLIENT);
    let vh = (h - st.inset_top - st.inset_bottom).max(MIN_EMBED_CLIENT);

    // Find first window right above mainHwnd that isn't hud or video so Majlis stays cleanly
    // in its own Z-slice without jumping on top of unrelated focused apps.
    let mut anchor = GetWindow(main, GW_HWNDPREV).ok();
    let mut hops = 0;
    while let Some(a) = anchor {
        if a != HWND(st.hud_hwnd as *mut _) && a != video {
            break;
        }
        hops += 1;
        if hops > 32 {
            anchor = None;
            break;
        }
        anchor = GetWindow(a, GW_HWNDPREV).ok();
    }
    let hud_after = if main_topmost {
        match anchor {
            Some(a) if (GetWindowLongW(a, GWL_EXSTYLE) & (WS_EX_TOPMOST.0 as i32)) != 0 => a,
            _ => HWND_TOPMOST,
        }
    } else {
        anchor.unwrap_or(HWND_TOP)
    };

    if !st.video_visible {
        let _ = SetWindowPos(
            video,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_HIDEWINDOW,
        );
        if let Some(hud_win) = hud {
            let _ = SetWindowPos(hud_win, Some(hud_after), pt.x, pt.y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }
        return;
    }

    if let Some(hud_win) = hud {
        let deferred = (|| -> bool {
            let Ok(mut hdwp) = BeginDeferWindowPos(2) else {
                return false;
            };
            let Ok(next1) = DeferWindowPos(
                hdwp,
                hud_win,
                Some(hud_after),
                pt.x,
                pt.y,
                w,
                h,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            ) else {
                return false;
            };
            hdwp = next1;
            let Ok(next2) = DeferWindowPos(
                hdwp,
                video,
                Some(hud_win),
                vx,
                vy,
                vw,
                vh,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            ) else {
                return false;
            };
            EndDeferWindowPos(next2).is_ok()
        })();
        if !deferred {
            let _ = SetWindowPos(hud_win, Some(hud_after), pt.x, pt.y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
            let _ = SetWindowPos(video, Some(hud_win), vx, vy, vw, vh, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }
    } else {
        let _ = SetWindowPos(video, Some(hud_after), vx, vy, vw, vh, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
}

unsafe extern "system" fn main_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    ref_data: usize,
) -> LRESULT {
    let res = DefSubclassProc(hwnd, msg, wparam, lparam);
    match msg {
        WM_WINDOWPOSCHANGED | WM_SIZE | WM_MOVE | WM_SHOWWINDOW | WM_ACTIVATE | WM_EXITSIZEMOVE => {
            if let Some(st) = get_sync_state(ref_data) {
                sync_layout_now(st);
            }
        }
        _ => {}
    }
    res
}

// Harbor minimize / iconic D3D11 swapchain size guard: swallow <64px WM_SIZE on video host
unsafe extern "system" fn mpv_size_guard_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    ref_data: usize,
) -> LRESULT {
    if msg == WM_SIZE {
        let nw = (lparam.0 & 0xFFFF) as i32;
        let nh = ((lparam.0 >> 16) & 0xFFFF) as i32;
        if ref_data != 0 {
            let main = HWND(ref_data as *mut _);
            if IsWindow(Some(main)).as_bool() && IsIconic(main).as_bool() {
                return LRESULT(0);
            }
        }
        if nw > 0 && nh > 0 && (nw < MIN_EMBED_CLIENT || nh < MIN_EMBED_CLIENT) {
            return LRESULT(0);
        }
    } else if msg == WM_WINDOWPOSCHANGED {
        let _ = lparam.0 as *const WindowPos;
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

unsafe extern "system" fn video_host_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match msg {
        WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE),
        WM_APP_DESTROY_HOST => {
            let _ = RemoveWindowSubclass(hwnd, Some(mpv_size_guard_proc), MAJLIS_SIZE_GUARD_ID);
            let _ = DestroyWindow(hwnd);
            LRESULT(0)
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn spawn_video_host(owner_hwnd: isize) -> std::result::Result<(isize, JoinHandle<()>), String> {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let handle = thread::Builder::new()
        .name("mpv-win32-host".into())
        .spawn(move || unsafe {
            let hinst = GetModuleHandleW(None).unwrap_or_default();
            let cls_name = w!("MajlisVideoHostClass");
            let black = GetStockObject(BLACK_BRUSH);
            let wc = WNDCLASSW {
                lpfnWndProc: Some(video_host_wnd_proc),
                hInstance: hinst.into(),
                lpszClassName: cls_name,
                hbrBackground: HBRUSH(black.0),
                ..Default::default()
            };
            let _ = RegisterClassW(&wc);
            let owner = if owner_hwnd != 0 {
                Some(HWND(owner_hwnd as *mut _))
            } else {
                None
            };
            let hwnd_res = CreateWindowExW(
                WS_EX_NOACTIVATE,
                cls_name,
                w!("Majlis"),
                WS_POPUP | WS_CLIPSIBLINGS,
                -32000,
                -32000,
                320,
                180,
                owner,
                None,
                Some(hinst.into()),
                None,
            );
            let Ok(hwnd) = hwnd_res else {
                let _ = tx.send(Err("CreateWindowExW for MajlisVideoHost failed".to_string()));
                return;
            };
            let _ = SetWindowSubclass(
                hwnd,
                Some(mpv_size_guard_proc),
                MAJLIS_SIZE_GUARD_ID,
                owner_hwnd as usize,
            );
            let _ = tx.send(Ok(hwnd.0 as isize));

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        })
        .map_err(|e| format!("spawn video host thread: {e}"))?;

    match rx.recv() {
        Ok(Ok(hwnd)) => Ok((hwnd, handle)),
        Ok(Err(e)) => {
            let _ = handle.join();
            Err(e)
        }
        Err(e) => {
            let _ = handle.join();
            Err(format!("video host init interrupted: {e}"))
        }
    }
}

fn parse_hwnd_str(raw: &str) -> isize {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return 0;
    }
    trimmed.parse::<isize>().unwrap_or(0)
}

// ------------------------------------------------------------------ libmpv C ABI
type mpv_handle = c_void;

const MPV_FORMAT_NONE: c_int = 0;
const MPV_FORMAT_STRING: c_int = 1;
const MPV_FORMAT_FLAG: c_int = 3;
const MPV_FORMAT_INT64: c_int = 4;
const MPV_FORMAT_DOUBLE: c_int = 5;
const MPV_FORMAT_NODE: c_int = 6;
const MPV_FORMAT_NODE_ARRAY: c_int = 7;
const MPV_FORMAT_NODE_MAP: c_int = 8;

const MPV_EVENT_NONE: c_int = 0;
const MPV_EVENT_SHUTDOWN: c_int = 1;
const MPV_EVENT_START_FILE: c_int = 6;
const MPV_EVENT_END_FILE: c_int = 7;
const MPV_EVENT_FILE_LOADED: c_int = 8;
const MPV_EVENT_IDLE: c_int = 11;
const MPV_EVENT_SEEK: c_int = 20;
const MPV_EVENT_PLAYBACK_RESTART: c_int = 21;
const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;

#[repr(C)]
#[derive(Copy, Clone)]
union MpvNodeUnion {
    string: *mut c_char,
    flag: c_int,
    int64: i64,
    double_: c_double,
    list: *mut mpv_node_list,
    ptr: *mut c_void,
}

#[repr(C)]
#[derive(Copy, Clone)]
struct mpv_node {
    u: MpvNodeUnion,
    format: c_int,
}

#[repr(C)]
struct mpv_node_list {
    num: c_int,
    values: *mut mpv_node,
    keys: *mut *mut c_char,
}

#[repr(C)]
struct mpv_event {
    event_id: c_int,
    error: c_int,
    reply_userdata: c_ulonglong,
    data: *mut c_void,
}

#[repr(C)]
struct mpv_event_property {
    name: *const c_char,
    format: c_int,
    data: *mut c_void,
}

#[repr(C)]
struct mpv_event_end_file {
    reason: c_int,
    error: c_int,
    playlist_entry_id: i64,
    playlist_insert_id: i64,
    playlist_insert_num_entries: c_int,
}

struct MpvApi {
    _lib: Library,
    create: unsafe extern "C" fn() -> *mut mpv_handle,
    initialize: unsafe extern "C" fn(*mut mpv_handle) -> c_int,
    terminate_destroy: unsafe extern "C" fn(*mut mpv_handle),
    set_option_string: unsafe extern "C" fn(*mut mpv_handle, *const c_char, *const c_char) -> c_int,
    set_property_string: unsafe extern "C" fn(*mut mpv_handle, *const c_char, *const c_char) -> c_int,
    get_property_string: unsafe extern "C" fn(*mut mpv_handle, *const c_char) -> *mut c_char,
    free: unsafe extern "C" fn(*mut c_void),
    #[allow(dead_code)]
    free_node_contents: unsafe extern "C" fn(*mut mpv_node),
    command: unsafe extern "C" fn(*mut mpv_handle, *mut *const c_char) -> c_int,
    command_async: unsafe extern "C" fn(*mut mpv_handle, c_ulonglong, *mut *const c_char) -> c_int,
    observe_property: unsafe extern "C" fn(*mut mpv_handle, c_ulonglong, *const c_char, c_int) -> c_int,
    wait_event: unsafe extern "C" fn(*mut mpv_handle, c_double) -> *mut mpv_event,
    wakeup: unsafe extern "C" fn(*mut mpv_handle),
}

unsafe impl Send for MpvApi {}
unsafe impl Sync for MpvApi {}

impl MpvApi {
    fn load(dll_path: &str) -> std::result::Result<Self, String> {
        unsafe {
            let lib = Library::new(dll_path).map_err(|e| format!("load libmpv: {e}"))?;
            macro_rules! sym {
                ($s:literal) => {
                    *lib.get($s).map_err(|e| format!("missing sym {}: {e}", std::str::from_utf8_unchecked($s)))?
                };
            }
            Ok(Self {
                create: sym!(b"mpv_create\0"),
                initialize: sym!(b"mpv_initialize\0"),
                terminate_destroy: sym!(b"mpv_terminate_destroy\0"),
                set_option_string: sym!(b"mpv_set_option_string\0"),
                set_property_string: sym!(b"mpv_set_property_string\0"),
                get_property_string: sym!(b"mpv_get_property_string\0"),
                free: sym!(b"mpv_free\0"),
                free_node_contents: sym!(b"mpv_free_node_contents\0"),
                command: sym!(b"mpv_command\0"),
                command_async: sym!(b"mpv_command_async\0"),
                observe_property: sym!(b"mpv_observe_property\0"),
                wait_event: sym!(b"mpv_wait_event\0"),
                wakeup: sym!(b"mpv_wakeup\0"),
                _lib: lib,
            })
        }
    }
}

unsafe fn c_to_string(p: *const c_char) -> String {
    if p.is_null() {
        String::new()
    } else {
        CStr::from_ptr(p).to_string_lossy().into_owned()
    }
}

unsafe fn mpv_node_to_json(node: *const mpv_node) -> Value {
    if node.is_null() {
        return Value::Null;
    }
    let n = &*node;
    match n.format {
        MPV_FORMAT_NONE => Value::Null,
        MPV_FORMAT_STRING => Value::String(c_to_string(n.u.string)),
        MPV_FORMAT_FLAG => Value::Bool(n.u.flag != 0),
        MPV_FORMAT_INT64 => Value::from(n.u.int64),
        MPV_FORMAT_DOUBLE => {
            if n.u.double_.is_finite() {
                Value::from(n.u.double_)
            } else {
                Value::Null
            }
        }
        MPV_FORMAT_NODE_ARRAY => {
            if n.u.list.is_null() {
                return Value::Array(vec![]);
            }
            let list = &*n.u.list;
            let len = list.num.max(0) as usize;
            let mut out = Vec::with_capacity(len);
            for i in 0..len {
                out.push(mpv_node_to_json(list.values.add(i)));
            }
            Value::Array(out)
        }
        MPV_FORMAT_NODE_MAP => {
            if n.u.list.is_null() {
                return Value::Object(Default::default());
            }
            let list = &*n.u.list;
            let len = list.num.max(0) as usize;
            let mut map = serde_json::Map::with_capacity(len);
            for i in 0..len {
                let k = c_to_string(*list.keys.add(i));
                map.insert(k, mpv_node_to_json(list.values.add(i)));
            }
            Value::Object(map)
        }
        _ => Value::Null,
    }
}

struct Shared {
    api: Arc<MpvApi>,
    ctx: *mut mpv_handle,
    stopping: AtomicBool,
}

unsafe impl Send for Shared {}
unsafe impl Sync for Shared {}

// Harbor Windows WASAPI post-pause stall watchdog state
struct StallWatch {
    armed_until: Option<Instant>,
    paused_since: Option<Instant>,
    stall_start: Option<Instant>,
    stall_pos_start: f64,
    attempts: u8,
    last_pos: f64,
    paused: bool,
    paused_for_cache: bool,
    seeking: bool,
    idle: bool,
    speed: f64,
    cache_secs: f64,
    current_ao: String,
}

impl StallWatch {
    fn new() -> Self {
        Self {
            armed_until: None,
            paused_since: None,
            stall_start: None,
            stall_pos_start: 0.0,
            attempts: 0,
            last_pos: 0.0,
            paused: false,
            paused_for_cache: false,
            seeking: false,
            idle: true,
            speed: 1.0,
            cache_secs: 0.0,
            current_ao: String::new(),
        }
    }

    unsafe fn tick(&mut self, api: &MpvApi, ctx: *mut mpv_handle) {
        let Some(until) = self.armed_until else {
            return;
        };
        let now = Instant::now();
        if now > until || self.idle || self.paused || self.paused_for_cache || self.seeking {
            self.stall_start = None;
            if now > until {
                self.armed_until = None;
            }
            return;
        }
        if !self.current_ao.contains("wasapi") || self.cache_secs < 10.0 {
            self.stall_start = None;
            return;
        }
        match self.stall_start {
            None => {
                self.stall_start = Some(now);
                self.stall_pos_start = self.last_pos;
            }
            Some(t0) => {
                let elapsed = now.duration_since(t0).as_secs_f64();
                if elapsed >= 6.0 {
                    let expected = elapsed * self.speed.max(0.25);
                    let progressed = (self.last_pos - self.stall_pos_start).max(0.0);
                    if progressed < expected * 0.25 && self.attempts < 2 {
                        self.attempts += 1;
                        self.stall_start = Some(now);
                        self.stall_pos_start = self.last_pos;
                        if self.attempts == 1 {
                            let cmd = b"ao-reload\0".as_ptr() as *const c_char;
                            let mut argv = [cmd, null()];
                            (api.command_async)(ctx, 9001, argv.as_mut_ptr());
                        } else if let Ok(pos_c) = CString::new(format!("{:.3}", self.last_pos)) {
                            let c0 = b"seek\0".as_ptr() as *const c_char;
                            let c2 = b"absolute+exact\0".as_ptr() as *const c_char;
                            let mut argv = [c0, pos_c.as_ptr(), c2, null()];
                            (api.command_async)(ctx, 9002, argv.as_mut_ptr());
                        }
                    } else if progressed >= expected * 0.25 {
                        self.armed_until = None;
                        self.stall_start = None;
                    }
                }
            }
        }
    }
}

fn event_loop(shared: Arc<Shared>, on_event: ThreadsafeFunction<String, ErrorStrategy::Fatal>) {
    let _timer_guard = TimerPeriodGuard::new(1);
    let mut watch = StallWatch::new();
    unsafe {
        while !shared.stopping.load(Ordering::SeqCst) {
            let ev = (shared.api.wait_event)(shared.ctx, 0.2);
            if ev.is_null() {
                watch.tick(&shared.api, shared.ctx);
                continue;
            }
            let e = &*ev;
            match e.event_id {
                MPV_EVENT_NONE => {
                    watch.tick(&shared.api, shared.ctx);
                }
                MPV_EVENT_SHUTDOWN => {
                    on_event.call(
                        json!({ "event": "shutdown" }).to_string(),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                    break;
                }
                MPV_EVENT_START_FILE => {
                    watch.idle = false;
                    watch.attempts = 0;
                    watch.stall_start = None;
                    on_event.call(
                        json!({ "event": "start-file" }).to_string(),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                }
                MPV_EVENT_FILE_LOADED => {
                    on_event.call(
                        json!({ "event": "file-loaded" }).to_string(),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                }
                MPV_EVENT_PLAYBACK_RESTART => {
                    watch.seeking = false;
                    on_event.call(
                        json!({ "event": "playback-restart" }).to_string(),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                }
                MPV_EVENT_SEEK => {
                    watch.seeking = true;
                }
                MPV_EVENT_IDLE => {
                    watch.idle = true;
                    watch.armed_until = None;
                }
                MPV_EVENT_END_FILE => {
                    let ef = if !e.data.is_null() {
                        &*(e.data as *const mpv_event_end_file)
                    } else {
                        continue;
                    };
                    let reason = match ef.reason {
                        0 => "eof",
                        2 => "stop",
                        3 => "quit",
                        4 => "error",
                        5 => "redirect",
                        _ => "unknown",
                    };
                    on_event.call(
                        json!({ "event": "end-file", "reason": reason, "error": ef.error }).to_string(),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                }
                MPV_EVENT_PROPERTY_CHANGE => {
                    if e.data.is_null() {
                        continue;
                    }
                    let prop = &*(e.data as *const mpv_event_property);
                    let name = c_to_string(prop.name);
                    let val = if prop.data.is_null() {
                        Value::Null
                    } else {
                        match prop.format {
                            MPV_FORMAT_NODE => mpv_node_to_json(prop.data as *const mpv_node),
                            MPV_FORMAT_STRING => Value::String(c_to_string(*(prop.data as *const *const c_char))),
                            MPV_FORMAT_FLAG => Value::Bool(*(prop.data as *const c_int) != 0),
                            MPV_FORMAT_INT64 => Value::from(*(prop.data as *const i64)),
                            MPV_FORMAT_DOUBLE => {
                                let d = *(prop.data as *const c_double);
                                if d.is_finite() { Value::from(d) } else { Value::Null }
                            }
                            _ => Value::Null,
                        }
                    };
                    match name.as_str() {
                        "pause" => {
                            let p = val.as_bool().unwrap_or(false);
                            if p && !watch.paused {
                                watch.paused_since = Some(Instant::now());
                            } else if !p && watch.paused {
                                if let Some(since) = watch.paused_since.take() {
                                    if since.elapsed().as_secs() >= 10 {
                                        watch.armed_until = Some(Instant::now() + std::time::Duration::from_secs(90));
                                        watch.attempts = 0;
                                        watch.stall_start = None;
                                    }
                                }
                            }
                            watch.paused = p;
                        }
                        "time-pos" => {
                            if let Some(pos) = val.as_f64() {
                                watch.last_pos = pos;
                            }
                        }
                        "paused-for-cache" => {
                            watch.paused_for_cache = val.as_bool().unwrap_or(false);
                        }
                        "speed" => {
                            if let Some(sp) = val.as_f64() {
                                watch.speed = sp;
                            }
                        }
                        "demuxer-cache-duration" => {
                            if let Some(cs) = val.as_f64() {
                                watch.cache_secs = cs;
                            }
                        }
                        "current-ao" => {
                            if let Some(ao) = val.as_str() {
                                watch.current_ao = ao.to_string();
                            }
                        }
                        _ => {}
                    }
                    on_event.call(
                        json!({ "event": "property-change", "name": name, "data": val }).to_string(),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                }
                _ => {}
            }
        }
    }
}

#[napi]
pub struct NativeMpvPlayer {
    shared: Arc<Shared>,
    cmd_lock: Mutex<()>,
    sync_state: Mutex<SyncState>,
    sync_token: usize,
    subclassed_main: AtomicIsize,
    video_host_thread: Mutex<Option<JoinHandle<()>>>,
    event_thread: Mutex<Option<JoinHandle<()>>>,
}

#[napi]
impl NativeMpvPlayer {
    #[napi(constructor)]
    pub fn new(
        env: Env,
        dll_path: String,
        options: Vec<(String, String)>,
        watched_props: Vec<String>,
        main_hwnd_str: String,
        hud_hwnd_str: String,
        on_event: JsFunction,
    ) -> Result<Self> {
        let mut ev_cb: ThreadsafeFunction<String, ErrorStrategy::Fatal> =
            on_event.create_threadsafe_function(0, |ctx: ThreadSafeCallContext<String>| {
                Ok(vec![ctx.env.create_string(&ctx.value)?.into_unknown()])
            })?;
        ev_cb.unref(&env)?;

        let main_hwnd = parse_hwnd_str(&main_hwnd_str);
        let hud_hwnd = parse_hwnd_str(&hud_hwnd_str);

        let (video_hwnd, host_handle) = if main_hwnd != 0 {
            let (vh, jh) = spawn_video_host(main_hwnd).map_err(Error::from_reason)?;
            (vh, Some(jh))
        } else {
            (0, None)
        };

        let api = Arc::new(MpvApi::load(&dll_path).map_err(Error::from_reason)?);
        let ctx = unsafe { (api.create)() };
        if ctx.is_null() {
            if video_hwnd != 0 {
                unsafe {
                    let _ = PostMessageW(Some(HWND(video_hwnd as *mut _)), WM_APP_DESTROY_HOST, WPARAM(0), LPARAM(0));
                }
            }
            if let Some(jh) = host_handle {
                let _ = jh.join();
            }
            return Err(Error::from_reason("mpv_create returned null"));
        }

        let token = NEXT_TOKEN.fetch_add(1, Ordering::Relaxed);
        let initial_sync = SyncState {
            main_hwnd,
            hud_hwnd,
            video_hwnd,
            visible: false,
            video_visible: true,
            ..Default::default()
        };
        register_sync_state(token, initial_sync);

        let mut subclassed: isize = 0;
        if main_hwnd != 0 {
            let mw = HWND(main_hwnd as *mut _);
            unsafe {
                // Compare Electron main UI thread before installing SetWindowSubclass
                let cur_tid = windows::Win32::System::Threading::GetCurrentThreadId();
                let win_tid = GetWindowThreadProcessId(mw, None);
                if cur_tid == win_tid
                    && SetWindowSubclass(mw, Some(main_subclass_proc), MAJLIS_SUBCLASS_ID, token).as_bool()
                {
                    subclassed = main_hwnd;
                }
            }
        }

        unsafe {
            if video_hwnd != 0 {
                if let (Ok(wk), Ok(wv)) = (CString::new("wid"), CString::new(video_hwnd.to_string())) {
                    (api.set_option_string)(ctx, wk.as_ptr(), wv.as_ptr());
                }
            }
            for (k, v) in options {
                if video_hwnd == 0 && (k == "vo" || k == "gpu-api") {
                    continue;
                }
                if let (Ok(ck), Ok(cv)) = (CString::new(k), CString::new(v)) {
                    (api.set_option_string)(ctx, ck.as_ptr(), cv.as_ptr());
                }
            }
            let rc = (api.initialize)(ctx);
            if rc < 0 {
                (api.terminate_destroy)(ctx);
                if subclassed != 0 {
                    let _ = RemoveWindowSubclass(HWND(subclassed as *mut _), Some(main_subclass_proc), MAJLIS_SUBCLASS_ID);
                }
                unregister_sync_state(token);
                if video_hwnd != 0 {
                    let _ = PostMessageW(Some(HWND(video_hwnd as *mut _)), WM_APP_DESTROY_HOST, WPARAM(0), LPARAM(0));
                }
                if let Some(jh) = host_handle {
                    let _ = jh.join();
                }
                return Err(Error::from_reason(format!("mpv_initialize failed ({rc})")));
            }
            // Observe all UI props plus internal WASAPI stall-recovery properties
            let mut seen = std::collections::HashSet::new();
            let mut uid: c_ulonglong = 1;
            for prop in watched_props
                .iter()
                .map(|s| s.as_str())
                .chain(["pause", "time-pos", "paused-for-cache", "speed", "demuxer-cache-duration", "current-ao"])
            {
                if seen.insert(prop.to_string()) {
                    if let Ok(cp) = CString::new(prop) {
                        (api.observe_property)(ctx, uid, cp.as_ptr(), MPV_FORMAT_NODE);
                        uid += 1;
                    }
                }
            }
        }

        let shared = Arc::new(Shared {
            api,
            ctx,
            stopping: AtomicBool::new(false),
        });
        let s_event = shared.clone();
        let event_handle = thread::Builder::new()
            .name("mpv-native-events".into())
            .spawn(move || event_loop(s_event, ev_cb))
            .map_err(|e| Error::from_reason(format!("spawn event thread: {e}")))?;

        Ok(Self {
            shared,
            cmd_lock: Mutex::new(()),
            sync_state: Mutex::new(initial_sync),
            sync_token: token,
            subclassed_main: AtomicIsize::new(subclassed),
            video_host_thread: Mutex::new(host_handle),
            event_thread: Mutex::new(Some(event_handle)),
        })
    }

    #[napi]
    pub fn attach_windows(&self, main_hwnd_str: String, hud_hwnd_str: String) {
        let mh = parse_hwnd_str(&main_hwnd_str);
        let hh = parse_hwnd_str(&hud_hwnd_str);
        let mut guard = self.sync_state.lock().unwrap();
        let old_sub = self.subclassed_main.load(Ordering::Relaxed);
        if mh != 0 && old_sub != mh {
            unsafe {
                if old_sub != 0 {
                    let _ = RemoveWindowSubclass(HWND(old_sub as *mut _), Some(main_subclass_proc), MAJLIS_SUBCLASS_ID);
                }
                let mw = HWND(mh as *mut _);
                let cur_tid = windows::Win32::System::Threading::GetCurrentThreadId();
                if cur_tid == GetWindowThreadProcessId(mw, None)
                    && SetWindowSubclass(mw, Some(main_subclass_proc), MAJLIS_SUBCLASS_ID, self.sync_token).as_bool()
                {
                    self.subclassed_main.store(mh, Ordering::Relaxed);
                }
            }
        }
        if mh != 0 {
            guard.main_hwnd = mh;
        }
        guard.hud_hwnd = hh;
        let snapshot = *guard;
        drop(guard);
        register_sync_state(self.sync_token, snapshot);
        unsafe { sync_layout_now(snapshot); }
    }

    #[napi]
    pub fn set_visible(&self, visible: bool) {
        let mut guard = self.sync_state.lock().unwrap();
        guard.visible = visible;
        let snapshot = *guard;
        drop(guard);
        register_sync_state(self.sync_token, snapshot);
        unsafe { sync_layout_now(snapshot); }
    }

    #[napi]
    pub fn set_video_visible(&self, video_visible: bool) {
        let mut guard = self.sync_state.lock().unwrap();
        guard.video_visible = video_visible;
        let snapshot = *guard;
        drop(guard);
        register_sync_state(self.sync_token, snapshot);
        unsafe { sync_layout_now(snapshot); }
    }

    #[napi]
    pub fn sync_bounds(&self) {
        let snapshot = *self.sync_state.lock().unwrap();
        unsafe { sync_layout_now(snapshot); }
    }

    #[napi]
    pub fn set_title(&self, title: String) {
        let vh = self.sync_state.lock().unwrap().video_hwnd;
        if vh == 0 {
            return;
        }
        let mut wide: Vec<u16> = title.encode_utf16().collect();
        wide.push(0);
        unsafe {
            let _ = SetWindowTextW(HWND(vh as *mut _), PCWSTR(wide.as_ptr()));
        }
    }

    #[napi]
    pub fn start_drag(&self) -> bool {
        let mh = self.sync_state.lock().unwrap().main_hwnd;
        if mh == 0 {
            return false;
        }
        unsafe {
            let main = HWND(mh as *mut _);
            let mut pt = POINT::default();
            let _ = GetCursorPos(&mut pt);
            let _ = ReleaseCapture();
            let _ = SetForegroundWindow(main);
            let lparam_val = (((pt.y & 0xFFFF) as isize) << 16) | ((pt.x & 0xFFFF) as isize);
            let _ = PostMessageW(
                Some(main),
                WM_NCLBUTTONDOWN,
                WPARAM(HTCAPTION as usize),
                LPARAM(lparam_val),
            );
            true
        }
    }

    #[napi]
    pub fn video_hwnd(&self) -> String {
        self.sync_state.lock().unwrap().video_hwnd.to_string()
    }

    #[napi]
    pub fn command(&self, args: Vec<String>) -> Result<()> {
        let _g = self.cmd_lock.lock().unwrap();
        if self.shared.stopping.load(Ordering::SeqCst) {
            return Err(Error::from_reason("mpv stopped"));
        }
        let cstrs: Vec<CString> = args
            .iter()
            .map(|s| CString::new(s.as_str()).map_err(|e| Error::from_reason(e.to_string())))
            .collect::<Result<Vec<_>>>()?;
        let mut ptrs: Vec<*const c_char> = cstrs.iter().map(|s| s.as_ptr()).collect();
        ptrs.push(null());
        let rc = unsafe { (self.shared.api.command)(self.shared.ctx, ptrs.as_mut_ptr()) };
        if rc < 0 {
            return Err(Error::from_reason(format!("mpv command error ({rc})")));
        }
        Ok(())
    }

    #[napi]
    pub fn set_property(&self, name: String, value_str: String) -> Result<()> {
        let _g = self.cmd_lock.lock().unwrap();
        if self.shared.stopping.load(Ordering::SeqCst) {
            return Err(Error::from_reason("mpv stopped"));
        }
        let cn = CString::new(name).map_err(|e| Error::from_reason(e.to_string()))?;
        let cv = CString::new(value_str).map_err(|e| Error::from_reason(e.to_string()))?;
        let rc = unsafe { (self.shared.api.set_property_string)(self.shared.ctx, cn.as_ptr(), cv.as_ptr()) };
        if rc < 0 {
            return Err(Error::from_reason(format!("mpv set_property error ({rc})")));
        }
        Ok(())
    }

    #[napi]
    pub fn get_property(&self, name: String) -> Result<Option<String>> {
        let _g = self.cmd_lock.lock().unwrap();
        if self.shared.stopping.load(Ordering::SeqCst) {
            return Ok(None);
        }
        let cn = CString::new(name).map_err(|e| Error::from_reason(e.to_string()))?;
        unsafe {
            let p = (self.shared.api.get_property_string)(self.shared.ctx, cn.as_ptr());
            if p.is_null() {
                return Ok(None);
            }
            let s = CStr::from_ptr(p).to_string_lossy().into_owned();
            (self.shared.api.free)(p as *mut c_void);
            Ok(Some(s))
        }
    }

    #[napi]
    pub fn release_media(&self) {
        self.set_visible(false);
        let _ = self.command(vec!["stop".to_string()]);
    }

    #[napi]
    pub fn destroy(&self) {
        let _g = self.cmd_lock.lock().unwrap();
        if self.shared.stopping.swap(true, Ordering::SeqCst) {
            return;
        }
        let sub = self.subclassed_main.swap(0, Ordering::SeqCst);
        if sub != 0 {
            unsafe {
                let _ = RemoveWindowSubclass(HWND(sub as *mut _), Some(main_subclass_proc), MAJLIS_SUBCLASS_ID);
            }
        }
        let vh = {
            let mut g = self.sync_state.lock().unwrap();
            g.visible = false;
            g.video_hwnd
        };
        unregister_sync_state(self.sync_token);

        unsafe {
            let quit = b"quit\0".as_ptr() as *const c_char;
            let mut argv = [quit, null()];
            (self.shared.api.command)(self.shared.ctx, argv.as_mut_ptr());
            (self.shared.api.wakeup)(self.shared.ctx);
        }
        if let Some(h) = self.event_thread.lock().unwrap().take() {
            let _ = h.join();
        }
        unsafe {
            (self.shared.api.terminate_destroy)(self.shared.ctx);
        }
        if vh != 0 {
            unsafe {
                let _ = PostMessageW(Some(HWND(vh as *mut _)), WM_APP_DESTROY_HOST, WPARAM(0), LPARAM(0));
            }
        }
        if let Some(h) = self.video_host_thread.lock().unwrap().take() {
            let _ = h.join();
        }
    }
}

impl Drop for NativeMpvPlayer {
    fn drop(&mut self) {
        self.destroy();
    }
}
