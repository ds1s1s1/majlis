// The D3D11 device everything runs on, and the GPU colour converter/scaler (video processor):
// captured BGRA -> NV12 at the stream's size, never touching the CPU.
use std::mem::ManuallyDrop;
use windows::core::{Interface, Result};
use windows::Win32::Foundation::{HMODULE, RECT};
use windows::Win32::Graphics::Direct3D::*;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::Graphics::Dxgi::*;

pub struct Gpu {
    pub device: ID3D11Device,
    pub ctx: ID3D11DeviceContext,
}

impl Gpu {
    pub fn new(adapter: Option<&IDXGIAdapter1>) -> Result<Gpu> {
        let mut device = None;
        let mut ctx = None;
        let levels = [D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0];
        unsafe {
            D3D11CreateDevice(
                adapter.map(|a| a.cast::<IDXGIAdapter>()).transpose()?.as_ref(),
                if adapter.is_some() { D3D_DRIVER_TYPE_UNKNOWN } else { D3D_DRIVER_TYPE_HARDWARE },
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
                Some(&levels),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut ctx),
            )?;
        }
        let device: ID3D11Device = device.unwrap();
        // NVENC and the capture APIs may touch the device from their own threads
        if let Ok(mt) = device.cast::<ID3D11Multithread>() {
            unsafe { let _ = mt.SetMultithreadProtected(true); }
        }
        Ok(Gpu { device, ctx: ctx.unwrap() })
    }

    pub fn texture(&self, w: u32, h: u32, fmt: DXGI_FORMAT, bind: D3D11_BIND_FLAG) -> Result<ID3D11Texture2D> {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: w,
            Height: h,
            MipLevels: 1,
            ArraySize: 1,
            Format: fmt,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: bind.0 as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };
        let mut t = None;
        unsafe { self.device.CreateTexture2D(&desc, None, Some(&mut t))? };
        Ok(t.unwrap())
    }
}

// All outputs (displays) across adapters, in order. Index = what the app calls the display.
pub fn outputs() -> Result<Vec<(IDXGIAdapter1, IDXGIOutput)>> {
    let f: IDXGIFactory1 = unsafe { CreateDXGIFactory1()? };
    let mut list = vec![];
    let mut i = 0;
    while let Ok(a) = unsafe { f.EnumAdapters1(i) } {
        let mut j = 0;
        while let Ok(o) = unsafe { a.EnumOutputs(j) } {
            list.push((a.clone(), o));
            j += 1;
        }
        i += 1;
    }
    Ok(list)
}

pub fn first_adapter() -> Option<IDXGIAdapter1> {
    let f: IDXGIFactory1 = unsafe { CreateDXGIFactory1().ok()? };
    unsafe { f.EnumAdapters1(0).ok() }
}

// BGRA (any size) -> NV12 (stream size), letterboxed to keep the aspect ratio.
pub struct Converter {
    vctx: ID3D11VideoContext,
    vp: ID3D11VideoProcessor,
    vpe: ID3D11VideoProcessorEnumerator,
    vdev: ID3D11VideoDevice,
    out_view: ID3D11VideoProcessorOutputView,
    in_view: Option<(usize, ID3D11VideoProcessorInputView)>,
    pub in_w: u32,
    pub in_h: u32,
    pub out_w: u32,
    pub out_h: u32,
}

impl Converter {
    pub fn new(gpu: &Gpu, in_w: u32, in_h: u32, out: &ID3D11Texture2D, out_w: u32, out_h: u32) -> Result<Converter> {
        let vdev: ID3D11VideoDevice = gpu.device.cast()?;
        let vctx: ID3D11VideoContext = gpu.ctx.cast()?;
        let desc = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
            InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            InputFrameRate: DXGI_RATIONAL { Numerator: 60, Denominator: 1 },
            InputWidth: in_w,
            InputHeight: in_h,
            OutputFrameRate: DXGI_RATIONAL { Numerator: 60, Denominator: 1 },
            OutputWidth: out_w,
            OutputHeight: out_h,
            Usage: D3D11_VIDEO_USAGE_OPTIMAL_SPEED,
        };
        let vpe = unsafe { vdev.CreateVideoProcessorEnumerator(&desc)? };
        let vp = unsafe { vdev.CreateVideoProcessor(&vpe, 0)? };
        let od = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
            ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 } },
        };
        let mut out_view = None;
        unsafe { vdev.CreateVideoProcessorOutputView(out, &vpe, &od, Some(&mut out_view))? };
        let c = Converter { vctx, vp, vpe, vdev, out_view: out_view.unwrap(), in_view: None, in_w, in_h, out_w, out_h };
        unsafe {
            // no "enhancements": they cost time and change colours
            c.vctx.VideoProcessorSetStreamAutoProcessingMode(&c.vp, 0, false);
            c.vctx.VideoProcessorSetStreamFrameFormat(&c.vp, 0, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
            if let Ok(v1) = c.vctx.cast::<ID3D11VideoContext1>() {
                v1.VideoProcessorSetStreamColorSpace1(&c.vp, 0, DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709);
                v1.VideoProcessorSetOutputColorSpace1(&c.vp, DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709);
            }
        }
        Ok(c)
    }

    // src: BGRA texture; content: the part of it that holds the picture (a window may shrink)
    pub fn convert(&mut self, src: &ID3D11Texture2D, content_w: u32, content_h: u32) -> Result<()> {
        let key = src.as_raw() as usize;
        if self.in_view.as_ref().map(|v| v.0) != Some(key) {
            let id = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
                FourCC: 0,
                ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
                Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPIV { MipSlice: 0, ArraySlice: 0 } },
            };
            let mut v = None;
            unsafe { self.vdev.CreateVideoProcessorInputView(src, &self.vpe, &id, Some(&mut v))? };
            self.in_view = Some((key, v.unwrap()));
        }
        let cw = content_w.clamp(2, self.in_w);
        let ch = content_h.clamp(2, self.in_h);
        // fit inside the output, centred
        let s = f64::min(self.out_w as f64 / cw as f64, self.out_h as f64 / ch as f64);
        let dw = ((cw as f64 * s).round() as i32).min(self.out_w as i32);
        let dh = ((ch as f64 * s).round() as i32).min(self.out_h as i32);
        let dx = (self.out_w as i32 - dw) / 2;
        let dy = (self.out_h as i32 - dh) / 2;
        let src_rect = RECT { left: 0, top: 0, right: cw as i32, bottom: ch as i32 };
        let dst_rect = RECT { left: dx, top: dy, right: dx + dw, bottom: dy + dh };
        let full = RECT { left: 0, top: 0, right: self.out_w as i32, bottom: self.out_h as i32 };
        unsafe {
            self.vctx.VideoProcessorSetStreamSourceRect(&self.vp, 0, true, Some(&src_rect));
            self.vctx.VideoProcessorSetStreamDestRect(&self.vp, 0, true, Some(&dst_rect));
            self.vctx.VideoProcessorSetOutputTargetRect(&self.vp, true, Some(&full));
            let stream = D3D11_VIDEO_PROCESSOR_STREAM {
                Enable: true.into(),
                OutputIndex: 0,
                InputFrameOrField: 0,
                PastFrames: 0,
                FutureFrames: 0,
                ppPastSurfaces: std::ptr::null_mut(),
                pInputSurface: ManuallyDrop::new(Some(self.in_view.as_ref().unwrap().1.clone())),
                ppFutureSurfaces: std::ptr::null_mut(),
                ppPastSurfacesRight: std::ptr::null_mut(),
                pInputSurfaceRight: ManuallyDrop::new(None),
                ppFutureSurfacesRight: std::ptr::null_mut(),
            };
            let streams = [stream];
            let r = self.vctx.VideoProcessorBlt(&self.vp, &self.out_view, 0, &streams);
            let [mut st] = streams;
            ManuallyDrop::drop(&mut st.pInputSurface);
            ManuallyDrop::drop(&mut st.pInputSurfaceRight);
            r
        }
    }
}
