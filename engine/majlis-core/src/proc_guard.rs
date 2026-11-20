// Process safety & display capability helpers for Majlis:
// 1. Windows Job Object (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) so child sidecars
//    (stremio-server node.exe, ffmpeg, mpv, majlis-engine) never survive app exit/crash.
// 2. DXGI IDXGIOutput6 HDR display detection for safe HDR passthrough vs SDR tone-mapping.
use std::mem::size_of;
use std::sync::OnceLock;
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND};
use windows::Win32::Graphics::Dxgi::Common::DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020;
use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput, IDXGIOutput6};
use windows::Win32::Graphics::Gdi::{MonitorFromWindow, HMONITOR, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

static JOB_HANDLE: OnceLock<isize> = OnceLock::new();

fn ensure_job() -> Option<HANDLE> {
    let raw = *JOB_HANDLE.get_or_init(|| unsafe {
        let Ok(job) = CreateJobObjectW(None, None) else {
            return 0;
        };
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok.is_err() {
            let _ = CloseHandle(job);
            return 0;
        }
        job.0 as isize
    });
    if raw == 0 {
        None
    } else {
        Some(HANDLE(raw as *mut _))
    }
}

pub fn adopt_pid(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let Some(job) = ensure_job() else {
        return false;
    };
    unsafe {
        let Ok(proc_h) = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) else {
            return false;
        };
        let assigned = AssignProcessToJobObject(job, proc_h).is_ok();
        let _ = CloseHandle(proc_h);
        assigned
    }
}

pub fn detect_hdr_for_hwnd(hwnd_val: isize) -> bool {
    if hwnd_val == 0 {
        return false;
    }
    unsafe {
        let hwnd = HWND(hwnd_val as *mut _);
        let hmon: HMONITOR = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if hmon.0.is_null() {
            return false;
        }
        let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else {
            return false;
        };
        let mut i = 0;
        while let Ok(adapter) = factory.EnumAdapters1(i) {
            i += 1;
            let adapter: IDXGIAdapter1 = adapter;
            let mut j = 0;
            while let Ok(output) = adapter.EnumOutputs(j) {
                j += 1;
                let output: IDXGIOutput = output;
                if let Ok(out6) = windows::core::Interface::cast::<IDXGIOutput6>(&output) {
                    if let Ok(desc) = out6.GetDesc1() {
                        if desc.Monitor == hmon {
                            return desc.ColorSpace == DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020;
                        }
                    }
                }
            }
        }
        false
    }
}
