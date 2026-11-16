// NVENC straight from the driver (nvEncodeAPI64.dll), no ffmpeg in between:
//  - the GPU texture goes in as is (registered once, mapped per frame)
//  - bitrate / frame rate change on the fly (nvEncReconfigureEncoder), no restart
//  - a keyframe whenever asked (FORCEIDR), or better: frames a viewer lost are invalidated
//    and the next frame references an older good one (no keyframe spike)
#![allow(non_upper_case_globals, non_camel_case_types, non_snake_case, dead_code, unused_imports, clippy::all)]
pub mod sys;

use std::ffi::c_void;
use std::sync::OnceLock;
use sys::*;
use windows::core::{Interface, PCSTR};
use windows::Win32::Graphics::Direct3D11::{ID3D11Device, ID3D11Texture2D};
use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

const fn guid(d1: u32, d2: u16, d3: u16, d4: [u8; 8]) -> GUID { GUID { Data1: d1, Data2: d2, Data3: d3, Data4: d4 } }
const CODEC_H264: GUID = guid(0x6bc82762, 0x4e63, 0x4ca4, [0xaa, 0x85, 0x1e, 0x50, 0xf3, 0x21, 0xf6, 0xbf]);
const CODEC_HEVC: GUID = guid(0x790cdc88, 0x4522, 0x4d7b, [0x94, 0x25, 0xbd, 0xa9, 0x97, 0x5f, 0x76, 0x03]);
const CODEC_AV1: GUID = guid(0x0a352289, 0x0aa7, 0x4759, [0x86, 0x2d, 0x5d, 0x15, 0xcd, 0x16, 0xd2, 0x54]);
const H264_HIGH: GUID = guid(0xe7cbc309, 0x4f7a, 0x4b89, [0xaf, 0x2a, 0xd5, 0x37, 0xc9, 0x2b, 0xe3, 0x10]);
const HEVC_MAIN: GUID = guid(0xb514c39a, 0xb55b, 0x40fa, [0x87, 0x8f, 0xf1, 0x25, 0x3b, 0x4d, 0xfd, 0xec]);
const HEVC_MAIN10: GUID = guid(0xfa4d2b6c, 0x3a5b, 0x411a, [0x80, 0x18, 0x0a, 0x3f, 0x5e, 0x3c, 0x9b, 0xe5]);
const AV1_MAIN: GUID = guid(0x5f2a39f5, 0xf14e, 0x4f95, [0x9a, 0x9e, 0xb7, 0x6d, 0x56, 0x8f, 0xcf, 0x97]);
const PRESETS: [GUID; 7] = [
    guid(0xfc0a8d3e, 0x45f8, 0x4cf8, [0x80, 0xc7, 0x29, 0x88, 0x71, 0x59, 0x0e, 0xbf]),
    guid(0xf581cfb8, 0x88d6, 0x4381, [0x93, 0xf0, 0xdf, 0x13, 0xf9, 0xc2, 0x7d, 0xab]),
    guid(0x36850110, 0x3a07, 0x441f, [0x94, 0xd5, 0x36, 0x70, 0x63, 0x1f, 0x91, 0xf6]),
    guid(0x90a7b826, 0xdf06, 0x4862, [0xb9, 0xd2, 0xcd, 0x6d, 0x73, 0xa0, 0x86, 0x81]),
    guid(0x21c6e6b4, 0x297a, 0x4cba, [0x99, 0x8f, 0xb6, 0xcb, 0xde, 0x72, 0xad, 0xe3]),
    guid(0x8e75c279, 0x6299, 0x4ab6, [0x83, 0x02, 0x0b, 0x21, 0x5a, 0x33, 0x5c, 0xf5]),
    guid(0x84848c12, 0x6f71, 0x4c13, [0x93, 0x1b, 0x53, 0xe2, 0x83, 0xf5, 0x79, 0x74]),
];

const API: u32 = NVENCAPI_MAJOR_VERSION | (NVENCAPI_MINOR_VERSION << 24);
const fn sv(v: u32) -> u32 { API | (v << 16) | (0x7 << 28) }
const fn sv_hi(v: u32) -> u32 { sv(v) | (1u32 << 31) }
const INFINITE_GOP: u32 = 0xffff_ffff;

type CreateInstance = unsafe extern "system" fn(*mut NV_ENCODE_API_FUNCTION_LIST) -> NVENCSTATUS;
type MaxVersion = unsafe extern "system" fn(*mut u32) -> NVENCSTATUS;

struct Api(NV_ENCODE_API_FUNCTION_LIST);
unsafe impl Send for Api {}
unsafe impl Sync for Api {}

fn api() -> Result<&'static NV_ENCODE_API_FUNCTION_LIST, String> {
    static API_FNS: OnceLock<Result<Api, String>> = OnceLock::new();
    API_FNS
        .get_or_init(|| unsafe {
            let lib = LoadLibraryW(windows::core::w!("nvEncodeAPI64.dll")).map_err(|_| "no NVIDIA encoder on this PC".to_string())?;
            let maxv = GetProcAddress(lib, PCSTR(b"NvEncodeAPIGetMaxSupportedVersion\0".as_ptr())).ok_or("old NVIDIA driver")?;
            let mut v = 0u32;
            std::mem::transmute::<_, MaxVersion>(maxv)(&mut v);
            let need = (NVENCAPI_MAJOR_VERSION << 4) | NVENCAPI_MINOR_VERSION;
            if v < need {
                return Err(format!("NVIDIA driver too old for the engine (API {}.{}), update the driver", v >> 4, v & 15));
            }
            let create = GetProcAddress(lib, PCSTR(b"NvEncodeAPICreateInstance\0".as_ptr())).ok_or("old NVIDIA driver")?;
            let mut list: NV_ENCODE_API_FUNCTION_LIST = std::mem::zeroed();
            list.version = sv(2);
            let st = std::mem::transmute::<_, CreateInstance>(create)(&mut list);
            if st != NV_ENC_SUCCESS { return Err(format!("NvEncodeAPICreateInstance {st}")); }
            Ok(Api(list))
        })
        .as_ref()
        .map(|a| &a.0)
        .map_err(|e| e.clone())
}

pub fn available() -> Result<(), String> { api().map(|_| ()) }

macro_rules! call {
    ($f:ident ( $($a:expr),* )) => {{
        let f = api()?.$f.ok_or(concat!(stringify!($f), " missing"))?;
        let st = unsafe { f($($a),*) };
        if st != NV_ENC_SUCCESS { Err(format!("{} failed ({})", stringify!($f), st)) } else { Ok(()) }
    }};
}

#[derive(Clone, Copy, PartialEq)]
pub enum Codec { H264, Hevc, Av1 }

impl Codec {
    pub fn parse(s: &str) -> Codec { match s { "av1" => Codec::Av1, "hevc" => Codec::Hevc, _ => Codec::H264 } }
    // what WebCodecs is told (Annex B / OBU stream, no description needed)
    pub fn webcodecs(&self, ten: bool) -> &'static str {
        match (self, ten) {
            (Codec::H264, _) => "avc1.640034",
            (Codec::Hevc, false) => "hvc1.1.6.L153.B0",
            (Codec::Hevc, true) => "hvc1.2.4.L153.B0",
            (Codec::Av1, false) => "av01.0.13M.08",
            (Codec::Av1, true) => "av01.0.13M.10",
        }
    }
}

pub struct Params {
    pub codec: Codec,
    pub w: u32,
    pub h: u32,
    pub fps: u32,
    pub kbps: u32,
    pub quality: String, // speed | balanced | quality
    pub ten_bit: bool,
}

pub struct Encoder {
    enc: *mut c_void,
    init: Box<NV_ENC_INITIALIZE_PARAMS>,
    cfg: Box<NV_ENC_CONFIG>,
    reg: NV_ENC_REGISTERED_PTR,
    out: NV_ENC_OUTPUT_PTR,
    pub input: ID3D11Texture2D,
    pub p: Params,
    frame_idx: u32,
    force_idr: bool,
}
unsafe impl Send for Encoder {}

impl Encoder {
    pub fn new(device: &ID3D11Device, input: ID3D11Texture2D, p: Params) -> Result<Encoder, String> {
        let mut enc: *mut c_void = std::ptr::null_mut();
        let mut op: NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS = unsafe { std::mem::zeroed() };
        op.version = sv(1);
        op.deviceType = NV_ENC_DEVICE_TYPE_DIRECTX;
        op.device = device.as_raw();
        op.apiVersion = API;
        call!(nvEncOpenEncodeSessionEx(&mut op, &mut enc))?;
        let mut e = Encoder {
            enc,
            init: Box::new(unsafe { std::mem::zeroed() }),
            cfg: Box::new(unsafe { std::mem::zeroed() }),
            reg: std::ptr::null_mut(),
            out: std::ptr::null_mut(),
            input,
            p,
            frame_idx: 0,
            force_idr: true,
        };
        if let Err(err) = e.setup() { e.close(); return Err(err); }
        Ok(e)
    }

    fn codec_guid(&self) -> GUID { match self.p.codec { Codec::H264 => CODEC_H264, Codec::Hevc => CODEC_HEVC, Codec::Av1 => CODEC_AV1 } }

    fn setup(&mut self) -> Result<(), String> {
        let p = &self.p;
        // speed = p1 ultra-low-latency; balanced = p4 low-latency; quality = p6 low-latency
        let (preset, tuning) = match p.quality.as_str() {
            "speed" => (PRESETS[0], NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY),
            "quality" => (PRESETS[5], NV_ENC_TUNING_INFO_LOW_LATENCY),
            _ => (PRESETS[3], NV_ENC_TUNING_INFO_LOW_LATENCY),
        };
        let mut pc: NV_ENC_PRESET_CONFIG = unsafe { std::mem::zeroed() };
        pc.version = sv_hi(5);
        pc.presetCfg.version = sv_hi(9);
        call!(nvEncGetEncodePresetConfigEx(self.enc, self.codec_guid(), preset, tuning, &mut pc))?;
        *self.cfg = pc.presetCfg;
        let cfg = &mut *self.cfg;
        cfg.version = sv_hi(9);
        cfg.gopLength = INFINITE_GOP;
        cfg.frameIntervalP = 1; // no B-frames
        let rc = &mut cfg.rcParams;
        rc.rateControlMode = NV_ENC_PARAMS_RC_CBR;
        rc.averageBitRate = p.kbps * 1000;
        rc.maxBitRate = p.kbps * 1000;
        // about two frames of buffer: the encoder keeps every frame close to its share
        rc.vbvBufferSize = (p.kbps * 1000 / p.fps.max(1)) * 2;
        rc.vbvInitialDelay = rc.vbvBufferSize;
        rc.set_zeroReorderDelay(1);
        if p.quality != "speed" { rc.set_enableAQ(1); rc.set_aqStrength(8); }
        rc.multiPass = NV_ENC_MULTI_PASS_DISABLED;
        let refresh = p.fps.max(30); // whole picture refreshed about once a second
        let ten = p.ten_bit && p.codec != Codec::H264;
        unsafe {
            match p.codec {
                Codec::H264 => {
                    cfg.profileGUID = H264_HIGH;
                    let c = &mut cfg.encodeCodecConfig.h264Config;
                    c.idrPeriod = INFINITE_GOP;
                    c.set_repeatSPSPPS(1);
                    c.set_enableIntraRefresh(1);
                    c.intraRefreshPeriod = refresh;
                    c.intraRefreshCnt = 10;
                    c.maxNumRefFrames = 16; // room to fall back past lost frames
                    c.h264VUIParameters.videoSignalTypePresentFlag = 1;
                    c.h264VUIParameters.videoFullRangeFlag = 0;
                    c.h264VUIParameters.colourDescriptionPresentFlag = 1;
                    c.h264VUIParameters.colourPrimaries = NV_ENC_VUI_COLOR_PRIMARIES_BT709;
                    c.h264VUIParameters.transferCharacteristics = NV_ENC_VUI_TRANSFER_CHARACTERISTIC_BT709;
                    c.h264VUIParameters.colourMatrix = NV_ENC_VUI_MATRIX_COEFFS_BT709;
                }
                Codec::Hevc => {
                    cfg.profileGUID = if ten { HEVC_MAIN10 } else { HEVC_MAIN };
                    let c = &mut cfg.encodeCodecConfig.hevcConfig;
                    c.idrPeriod = INFINITE_GOP;
                    c.set_repeatSPSPPS(1);
                    c.set_enableIntraRefresh(1);
                    c.intraRefreshPeriod = refresh;
                    c.intraRefreshCnt = 10;
                    c.maxNumRefFramesInDPB = 16;
                    c.inputBitDepth = NV_ENC_BIT_DEPTH_8;
                    c.outputBitDepth = if ten { NV_ENC_BIT_DEPTH_10 } else { NV_ENC_BIT_DEPTH_8 };
                    c.hevcVUIParameters.videoSignalTypePresentFlag = 1;
                    c.hevcVUIParameters.videoFullRangeFlag = 0;
                    c.hevcVUIParameters.colourDescriptionPresentFlag = 1;
                    c.hevcVUIParameters.colourPrimaries = NV_ENC_VUI_COLOR_PRIMARIES_BT709;
                    c.hevcVUIParameters.transferCharacteristics = NV_ENC_VUI_TRANSFER_CHARACTERISTIC_BT709;
                    c.hevcVUIParameters.colourMatrix = NV_ENC_VUI_MATRIX_COEFFS_BT709;
                }
                Codec::Av1 => {
                    cfg.profileGUID = AV1_MAIN;
                    let c = &mut cfg.encodeCodecConfig.av1Config;
                    c.idrPeriod = INFINITE_GOP;
                    c.set_repeatSeqHdr(1);
                    c.set_enableIntraRefresh(1);
                    c.intraRefreshPeriod = refresh;
                    c.intraRefreshCnt = 10;
                    c.maxNumRefFramesInDPB = 8;
                    c.inputBitDepth = NV_ENC_BIT_DEPTH_8;
                    c.outputBitDepth = if ten { NV_ENC_BIT_DEPTH_10 } else { NV_ENC_BIT_DEPTH_8 };
                    c.colorPrimaries = NV_ENC_VUI_COLOR_PRIMARIES_BT709;
                    c.transferCharacteristics = NV_ENC_VUI_TRANSFER_CHARACTERISTIC_BT709;
                    c.matrixCoefficients = NV_ENC_VUI_MATRIX_COEFFS_BT709;
                    c.colorRange = 0;
                }
            }
        }
        let codec_guid = self.codec_guid();
        let init = &mut *self.init;
        init.version = sv_hi(7);
        init.encodeGUID = codec_guid;
        init.presetGUID = preset;
        init.tuningInfo = tuning;
        init.encodeWidth = p.w;
        init.encodeHeight = p.h;
        init.darWidth = p.w;
        init.darHeight = p.h;
        init.maxEncodeWidth = p.w;
        init.maxEncodeHeight = p.h;
        init.frameRateNum = p.fps;
        init.frameRateDen = 1;
        init.enablePTD = 1;
        init.enableEncodeAsync = 0;
        init.encodeConfig = &mut *self.cfg;
        call!(nvEncInitializeEncoder(self.enc, &mut *self.init))?;

        let mut rr: NV_ENC_REGISTER_RESOURCE = unsafe { std::mem::zeroed() };
        rr.version = sv(5);
        rr.resourceType = NV_ENC_INPUT_RESOURCE_TYPE_DIRECTX;
        rr.width = p.w;
        rr.height = p.h;
        rr.resourceToRegister = self.input.as_raw();
        rr.bufferFormat = NV_ENC_BUFFER_FORMAT_NV12;
        rr.bufferUsage = NV_ENC_INPUT_IMAGE;
        call!(nvEncRegisterResource(self.enc, &mut rr))?;
        self.reg = rr.registeredResource;

        let mut bb: NV_ENC_CREATE_BITSTREAM_BUFFER = unsafe { std::mem::zeroed() };
        bb.version = sv(1);
        call!(nvEncCreateBitstreamBuffer(self.enc, &mut bb))?;
        self.out = bb.bitstreamBuffer;
        Ok(())
    }

    pub fn request_idr(&mut self) { self.force_idr = true; }

    // Encode what's in `input` now. Returns (bitstream, keyframe, frame index).
    pub fn encode(&mut self, ts: u64, out: &mut Vec<u8>) -> Result<(bool, u32), String> {
        let mut mp: NV_ENC_MAP_INPUT_RESOURCE = unsafe { std::mem::zeroed() };
        mp.version = sv(4);
        mp.registeredResource = self.reg;
        call!(nvEncMapInputResource(self.enc, &mut mp))?;
        let mut pp: NV_ENC_PIC_PARAMS = unsafe { std::mem::zeroed() };
        pp.version = sv_hi(7);
        pp.inputWidth = self.p.w;
        pp.inputHeight = self.p.h;
        pp.inputPitch = self.p.w;
        pp.inputBuffer = mp.mappedResource;
        pp.outputBitstream = self.out;
        pp.bufferFmt = mp.mappedBufferFmt;
        pp.pictureStruct = NV_ENC_PIC_STRUCT_FRAME;
        pp.inputTimeStamp = ts;
        pp.frameIdx = self.frame_idx;
        if self.force_idr {
            pp.encodePicFlags = NV_ENC_PIC_FLAG_FORCEIDR as u32 | NV_ENC_PIC_FLAG_OUTPUT_SPSPPS as u32;
        }
        let r = call!(nvEncEncodePicture(self.enc, &mut pp));
        let res = (|| {
            r?;
            let mut lb: NV_ENC_LOCK_BITSTREAM = unsafe { std::mem::zeroed() };
            lb.version = sv_hi(2);
            lb.outputBitstream = self.out;
            call!(nvEncLockBitstream(self.enc, &mut lb))?;
            out.clear();
            out.extend_from_slice(unsafe { std::slice::from_raw_parts(lb.bitstreamBufferPtr as *const u8, lb.bitstreamSizeInBytes as usize) });
            let key = lb.pictureType == NV_ENC_PIC_TYPE_IDR || lb.pictureType == NV_ENC_PIC_TYPE_I;
            call!(nvEncUnlockBitstream(self.enc, self.out))?;
            Ok((key, self.frame_idx))
        })();
        let _ = call!(nvEncUnmapInputResource(self.enc, mp.mappedResource));
        if res.is_ok() { self.force_idr = false; self.frame_idx = self.frame_idx.wrapping_add(1); }
        res
    }

    // New bitrate / frame rate without a restart (and without a keyframe)
    pub fn reconfigure(&mut self, kbps: Option<u32>, fps: Option<u32>) -> Result<(), String> {
        if let Some(k) = kbps { self.p.kbps = k.max(200); }
        if let Some(f) = fps { self.p.fps = f.clamp(10, 240); }
        let rc = &mut self.cfg.rcParams;
        rc.averageBitRate = self.p.kbps * 1000;
        rc.maxBitRate = self.p.kbps * 1000;
        rc.vbvBufferSize = (self.p.kbps * 1000 / self.p.fps.max(1)) * 2;
        rc.vbvInitialDelay = rc.vbvBufferSize;
        self.init.frameRateNum = self.p.fps;
        self.init.encodeConfig = &mut *self.cfg;
        let mut rp: NV_ENC_RECONFIGURE_PARAMS = unsafe { std::mem::zeroed() };
        rp.version = sv_hi(2);
        rp.reInitEncodeParams = *self.init;
        call!(nvEncReconfigureEncoder(self.enc, &mut rp))
    }

    // A viewer lost frames: never reference them (or anything after them) again
    pub fn invalidate(&mut self, timestamps: &[u64]) -> Result<(), String> {
        for &t in timestamps { call!(nvEncInvalidateRefFrames(self.enc, t))?; }
        Ok(())
    }

    fn close(&mut self) {
        unsafe {
            if let Ok(a) = api() {
                if !self.out.is_null() { if let Some(f) = a.nvEncDestroyBitstreamBuffer { f(self.enc, self.out); } }
                if !self.reg.is_null() { if let Some(f) = a.nvEncUnregisterResource { f(self.enc, self.reg); } }
                if !self.enc.is_null() { if let Some(f) = a.nvEncDestroyEncoder { f(self.enc); } }
            }
        }
        self.out = std::ptr::null_mut();
        self.reg = std::ptr::null_mut();
        self.enc = std::ptr::null_mut();
    }
}

impl Drop for Encoder {
    fn drop(&mut self) { self.close(); }
}
