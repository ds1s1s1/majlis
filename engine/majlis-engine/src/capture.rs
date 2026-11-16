// Picture sources. Both keep their own BGRA copy of the latest picture on the GPU (`tex`), so
// the source can be released right away and encoders read it whenever they're due.
//   Display: DXGI Desktop Duplication (only new frames when something on screen changed).
//   Window:  Windows Graphics Capture of one window (toasts and popups never get in).
use crate::gpu::{self, Gpu};
use windows::core::{Interface, Result};
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::{HANDLE, HWND, WAIT_OBJECT_0};
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::Graphics::Dxgi::*;
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject};
use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::UI::WindowsAndMessaging::{IsIconic, IsWindow, IsWindowVisible, ShowWindow, SW_RESTORE};

pub enum Capture {
    Display(Dda),
    Window(Wgc),
}

impl Capture {
    pub fn display(index: usize) -> Result<(Gpu, Capture)> {
        let outs = gpu::outputs()?;
        let (adapter, output) = outs.get(index).or(outs.first()).cloned().ok_or_else(|| windows::core::Error::from_hresult(DXGI_ERROR_NOT_FOUND))?;
        let gpu = Gpu::new(Some(&adapter))?;
        let dda = Dda::new(&gpu, output)?;
        Ok((gpu, Capture::Display(dda)))
    }

    pub fn window(hwnd: i64) -> Result<(Gpu, Capture)> {
        let gpu = Gpu::new(gpu::first_adapter().as_ref())?;
        let wgc = Wgc::new(&gpu, hwnd)?;
        Ok((gpu, Capture::Window(wgc)))
    }

    // Wait up to `timeout_ms` for a new picture. Ok(true) = `tex` holds a new one.
    pub fn next(&mut self, gpu: &Gpu, timeout_ms: u32) -> Result<bool> {
        match self {
            Capture::Display(d) => d.next(gpu, timeout_ms),
            Capture::Window(w) => w.next(gpu, timeout_ms),
        }
    }

    pub fn tex(&self) -> &ID3D11Texture2D { match self { Capture::Display(d) => &d.tex, Capture::Window(w) => &w.tex } }
    pub fn size(&self) -> (u32, u32) { match self { Capture::Display(d) => (d.w, d.h), Capture::Window(w) => (w.w, w.h) } }
    pub fn content(&self) -> (u32, u32) { match self { Capture::Display(d) => (d.w, d.h), Capture::Window(w) => (w.cw, w.ch) } }
}

// ------------------------------------------------------------------ desktop duplication
pub struct Dda {
    output: IDXGIOutput1,
    dup: Option<IDXGIOutputDuplication>,
    pub tex: ID3D11Texture2D,
    pub w: u32,
    pub h: u32,
}

impl Dda {
    fn new(gpu: &Gpu, output: IDXGIOutput) -> Result<Dda> {
        let desc = unsafe { output.GetDesc()? };
        let output: IDXGIOutput1 = output.cast()?;
        let r = desc.DesktopCoordinates;
        let (w, h) = (((r.right - r.left) as u32) & !1, ((r.bottom - r.top) as u32) & !1);
        let tex = gpu.texture(w.max(2), h.max(2), DXGI_FORMAT_B8G8R8A8_UNORM, D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE)?;
        let mut d = Dda { output, dup: None, tex, w, h };
        d.open(gpu)?;
        Ok(d)
    }

    fn open(&mut self, gpu: &Gpu) -> Result<()> {
        self.dup = Some(unsafe { self.output.DuplicateOutput(&gpu.device)? });
        Ok(())
    }

    fn next(&mut self, gpu: &Gpu, timeout_ms: u32) -> Result<bool> {
        if self.dup.is_none() {
            // lost earlier (mode switch, UAC, fullscreen flip): try again
            if self.open(gpu).is_err() { std::thread::sleep(std::time::Duration::from_millis(timeout_ms.min(50) as u64)); return Ok(false); }
        }
        let dup = self.dup.as_ref().unwrap();
        let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut res: Option<IDXGIResource> = None;
        match unsafe { dup.AcquireNextFrame(timeout_ms, &mut info, &mut res) } {
            Ok(()) => {}
            Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => return Ok(false),
            Err(e) if e.code() == DXGI_ERROR_ACCESS_LOST || e.code() == DXGI_ERROR_INVALID_CALL => { self.dup = None; return Ok(false); }
            Err(e) => return Err(e),
        }
        let mut got = false;
        // LastPresentTime 0 = only the mouse moved; the picture didn't change
        if info.LastPresentTime != 0 {
            if let Some(r) = res.as_ref() {
                let t: ID3D11Texture2D = r.cast()?;
                let mut d = D3D11_TEXTURE2D_DESC::default();
                unsafe { t.GetDesc(&mut d) };
                if d.Width & !1 == self.w && d.Height & !1 == self.h && d.Width == self.w && d.Height == self.h {
                    unsafe { gpu.ctx.CopyResource(&self.tex, &t) };
                } else {
                    let b = D3D11_BOX { left: 0, top: 0, front: 0, right: self.w.min(d.Width), bottom: self.h.min(d.Height), back: 1 };
                    unsafe { gpu.ctx.CopySubresourceRegion(&self.tex, 0, 0, 0, 0, &t, 0, Some(&b)) };
                }
                got = true;
            }
        }
        unsafe { let _ = dup.ReleaseFrame(); }
        Ok(got)
    }
}

// ------------------------------------------------------------------ one window
pub struct Wgc {
    pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    event: HANDLE,
    pub tex: ID3D11Texture2D,
    pub w: u32,
    pub h: u32,
    pub cw: u32,
    pub ch: u32,
    _token: i64,
}

impl Wgc {
    fn new(gpu: &Gpu, hwnd: i64) -> Result<Wgc> {
        let h = HWND(hwnd as _);
        unsafe {
            if !IsWindow(Some(h)).as_bool() || !IsWindowVisible(h).as_bool() {
                return Err(windows::core::Error::new(windows::core::HRESULT(0x80070578u32 as i32), "window is closed or hidden"));
            }
            // a minimised window has no picture
            if IsIconic(h).as_bool() { let _ = ShowWindow(h, SW_RESTORE); std::thread::sleep(std::time::Duration::from_millis(300)); }
        }
        let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        let item: GraphicsCaptureItem = unsafe { interop.CreateForWindow(h)? };
        let dxgi: IDXGIDevice = gpu.device.cast()?;
        let d3d: IDirect3DDevice = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? }.cast()?;
        let size = item.Size()?;
        let (w, hh) = ((size.Width as u32 & !1).max(64), (size.Height as u32 & !1).max(64));
        let tex = gpu.texture(w, hh, DXGI_FORMAT_B8G8R8A8_UNORM, D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE)?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&d3d, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size)?;
        let session = pool.CreateCaptureSession(&item)?;
        let _ = session.SetIsCursorCaptureEnabled(false);
        let _ = session.SetIsBorderRequired(false);
        let event = unsafe { CreateEventW(None, false, false, None)? };
        let ev = event.0 as usize;
        let token = pool.FrameArrived(&TypedEventHandler::new(move |_, _| {
            unsafe { let _ = SetEvent(HANDLE(ev as _)); }
            Ok(())
        }))?;
        session.StartCapture()?;
        Ok(Wgc { pool, session, event, tex, w, h: hh, cw: w, ch: hh, _token: token })
    }

    fn next(&mut self, gpu: &Gpu, timeout_ms: u32) -> Result<bool> {
        if unsafe { WaitForSingleObject(self.event, timeout_ms) } != WAIT_OBJECT_0 { return Ok(false); }
        let mut got = false;
        // drain to the newest frame
        while let Ok(frame) = self.pool.TryGetNextFrame() {
            let cs = frame.ContentSize()?;
            let access: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
            let t: ID3D11Texture2D = unsafe { access.GetInterface()? };
            let mut d = D3D11_TEXTURE2D_DESC::default();
            unsafe { t.GetDesc(&mut d) };
            self.cw = (cs.Width as u32).min(d.Width).min(self.w) & !1;
            self.ch = (cs.Height as u32).min(d.Height).min(self.h) & !1;
            let b = D3D11_BOX { left: 0, top: 0, front: 0, right: self.cw.max(2), bottom: self.ch.max(2), back: 1 };
            unsafe { gpu.ctx.CopySubresourceRegion(&self.tex, 0, 0, 0, 0, &t, 0, Some(&b)) };
            // the window was resized: let the pool follow (our copy keeps its size, the
            // converter fits the new content into the stream)
            if cs.Width as u32 != d.Width || cs.Height as u32 != d.Height {
                let _ = self.pool.Recreate(&CreateDirect3D11DeviceFromDXGIDeviceSafe(gpu)?, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, cs);
            }
            let _ = frame.Close();
            got = true;
        }
        Ok(got)
    }
}

#[allow(non_snake_case)]
fn CreateDirect3D11DeviceFromDXGIDeviceSafe(gpu: &Gpu) -> Result<IDirect3DDevice> {
    let dxgi: IDXGIDevice = gpu.device.cast()?;
    unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? }.cast()
}

impl Drop for Wgc {
    fn drop(&mut self) {
        let _ = self.session.Close();
        let _ = self.pool.Close();
        unsafe { let _ = windows::Win32::Foundation::CloseHandle(self.event); }
    }
}
