#![allow(non_camel_case_types, clippy::too_many_arguments, clippy::type_complexity)]
// Embedded in-process libmpv renderer for Majlis Theater mode.
// Runs libmpv inside the main Electron process so Windows Graphics Capture (Discord Application
// Capture) and BrowserWindow compositing see both the live video/subtitles and the Theater HUD in
// a single HWND. Renders via offscreen OpenGL 3.3 Core WGL FBO + 2-pass GLSL RGBA->NV12 conversion
// + double-buffered async PBOs, with automatic MPV_RENDER_API_TYPE_SW BGRA fallback.
use libloading::Library;
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi::{Env, JsFunction};
use napi_derive::napi;
use serde_json::{json, Value};
use std::ffi::{c_void, CStr, CString};
use std::os::raw::{c_char, c_double, c_int, c_uint, c_ulonglong};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use windows::core::w;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{GetDC, ReleaseDC, HDC};
use windows::Win32::Graphics::OpenGL::{
    ChoosePixelFormat, SetPixelFormat, wglCreateContext, wglDeleteContext, wglGetProcAddress,
    wglMakeCurrent, HGLRC, PFD_DOUBLEBUFFER, PFD_DRAW_TO_WINDOW, PFD_MAIN_PLANE, PFD_SUPPORT_OPENGL,
    PFD_TYPE_RGBA, PIXELFORMATDESCRIPTOR,
};
use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, WS_EX_TOOLWINDOW, WS_POPUP};

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

// ------------------------------------------------------------------ libmpv C ABI
type mpv_handle = c_void;
type mpv_render_context = c_void;

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
const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;

const MPV_RENDER_PARAM_INVALID: c_int = 0;
const MPV_RENDER_PARAM_API_TYPE: c_int = 1;
const MPV_RENDER_PARAM_OPENGL_INIT_PARAMS: c_int = 2;
const MPV_RENDER_PARAM_OPENGL_FBO: c_int = 3;
const MPV_RENDER_PARAM_FLIP_Y: c_int = 4;
const MPV_RENDER_PARAM_ADVANCED_CONTROL: c_int = 10;
const MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME: c_int = 12;
const MPV_RENDER_PARAM_SW_SIZE: c_int = 17;
const MPV_RENDER_PARAM_SW_FORMAT: c_int = 18;
const MPV_RENDER_PARAM_SW_STRIDE: c_int = 19;
const MPV_RENDER_PARAM_SW_POINTER: c_int = 20;
const MPV_RENDER_UPDATE_FRAME: u64 = 1;

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

#[repr(C)]
struct mpv_render_param {
    param_type: c_int,
    data: *mut c_void,
}

#[repr(C)]
struct mpv_opengl_init_params {
    get_proc_address: Option<unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void>,
    get_proc_address_ctx: *mut c_void,
}

#[repr(C)]
struct mpv_opengl_fbo {
    fbo: c_int,
    w: c_int,
    h: c_int,
    internal_format: c_int,
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
    observe_property: unsafe extern "C" fn(*mut mpv_handle, c_ulonglong, *const c_char, c_int) -> c_int,
    wait_event: unsafe extern "C" fn(*mut mpv_handle, c_double) -> *mut mpv_event,
    wakeup: unsafe extern "C" fn(*mut mpv_handle),
    render_context_create: unsafe extern "C" fn(*mut *mut mpv_render_context, *mut mpv_handle, *mut mpv_render_param) -> c_int,
    render_context_set_update_callback: unsafe extern "C" fn(*mut mpv_render_context, unsafe extern "C" fn(*mut c_void), *mut c_void),
    render_context_update: unsafe extern "C" fn(*mut mpv_render_context) -> u64,
    render_context_render: unsafe extern "C" fn(*mut mpv_render_context, *mut mpv_render_param) -> c_int,
    render_context_report_swap: unsafe extern "C" fn(*mut mpv_render_context),
    render_context_free: unsafe extern "C" fn(*mut mpv_render_context),
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
                observe_property: sym!(b"mpv_observe_property\0"),
                wait_event: sym!(b"mpv_wait_event\0"),
                wakeup: sym!(b"mpv_wakeup\0"),
                render_context_create: sym!(b"mpv_render_context_create\0"),
                render_context_set_update_callback: sym!(b"mpv_render_context_set_update_callback\0"),
                render_context_update: sym!(b"mpv_render_context_update\0"),
                render_context_render: sym!(b"mpv_render_context_render\0"),
                render_context_report_swap: sym!(b"mpv_render_context_report_swap\0"),
                render_context_free: sym!(b"mpv_render_context_free\0"),
                _lib: lib,
            })
        }
    }
}

unsafe fn c_to_string(p: *const c_char) -> String {
    if p.is_null() { String::new() } else { CStr::from_ptr(p).to_string_lossy().into_owned() }
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
            if n.u.double_.is_finite() { Value::from(n.u.double_) } else { Value::Null }
        }
        MPV_FORMAT_NODE_ARRAY => {
            if n.u.list.is_null() { return Value::Array(vec![]); }
            let list = &*n.u.list;
            let len = list.num.max(0) as usize;
            let mut out = Vec::with_capacity(len);
            for i in 0..len {
                out.push(mpv_node_to_json(list.values.add(i)));
            }
            Value::Array(out)
        }
        MPV_FORMAT_NODE_MAP => {
            if n.u.list.is_null() { return Value::Object(Default::default()); }
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

// ------------------------------------------------------------------ OpenGL 3.3 Core procs
const GL_COLOR_BUFFER_BIT: c_uint = 0x00004000;
const GL_TEXTURE_2D: c_uint = 0x0DE1;
const GL_RGBA: c_uint = 0x1908;
const GL_RED: c_uint = 0x1903;
const GL_RG: c_uint = 0x8227;
const GL_RGBA8: c_uint = 0x8058;
const GL_R8: c_uint = 0x8229;
const GL_RG8: c_uint = 0x822B;
const GL_UNSIGNED_BYTE: c_uint = 0x1401;
const GL_TEXTURE_MIN_FILTER: c_uint = 0x2801;
const GL_TEXTURE_MAG_FILTER: c_uint = 0x2800;
const GL_TEXTURE_WRAP_S: c_uint = 0x2802;
const GL_TEXTURE_WRAP_T: c_uint = 0x2803;
const GL_LINEAR: c_int = 0x2601;
const GL_NEAREST: c_int = 0x2600;
const GL_CLAMP_TO_EDGE: c_int = 0x812F;
const GL_FRAMEBUFFER: c_uint = 0x8D40;
const GL_COLOR_ATTACHMENT0: c_uint = 0x8CE0;
const GL_FRAMEBUFFER_COMPLETE: c_uint = 0x8CD5;
const GL_TEXTURE0: c_uint = 0x84C0;
const GL_TRIANGLES: c_uint = 0x0004;
const GL_VERTEX_SHADER: c_uint = 0x8B31;
const GL_FRAGMENT_SHADER: c_uint = 0x8B30;
const GL_COMPILE_STATUS: c_uint = 0x8B81;
const GL_LINK_STATUS: c_uint = 0x8B82;
const GL_PIXEL_PACK_BUFFER: c_uint = 0x88EB;
const GL_STREAM_READ: c_uint = 0x88E1;
const GL_MAP_READ_BIT: c_uint = 0x0001;
const GL_PACK_ALIGNMENT: c_uint = 0x0D05;
const GL_DITHER: c_uint = 0x0BD0;

const WGL_CONTEXT_MAJOR_VERSION_ARB: c_int = 0x2091;
const WGL_CONTEXT_MINOR_VERSION_ARB: c_int = 0x2092;
const WGL_CONTEXT_PROFILE_MASK_ARB: c_int = 0x9126;
const WGL_CONTEXT_CORE_PROFILE_BIT_ARB: c_int = 0x0001;

unsafe extern "C" fn mpv_get_gl_proc(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    if name.is_null() {
        return null_mut();
    }
    let cname = CStr::from_ptr(name);
    if let Some(p) = wglGetProcAddress(windows::core::PCSTR(cname.as_ptr() as *const u8)) {
        let addr = p as usize;
        if addr > 3 && addr != usize::MAX {
            return addr as *mut c_void;
        }
    }
    if let Ok(hmod) = GetModuleHandleW(w!("opengl32.dll")) {
        if let Some(p) = GetProcAddress(hmod, windows::core::PCSTR(cname.as_ptr() as *const u8)) {
            return p as *mut c_void;
        }
    }
    null_mut()
}

struct Gl {
    viewport: unsafe extern "system" fn(c_int, c_int, c_int, c_int),
    clear_color: unsafe extern "system" fn(f32, f32, f32, f32),
    clear: unsafe extern "system" fn(c_uint),
    disable: unsafe extern "system" fn(c_uint),
    pixel_storei: unsafe extern "system" fn(c_uint, c_int),
    gen_textures: unsafe extern "system" fn(c_int, *mut c_uint),
    delete_textures: unsafe extern "system" fn(c_int, *const c_uint),
    bind_texture: unsafe extern "system" fn(c_uint, c_uint),
    tex_image_2d: unsafe extern "system" fn(c_uint, c_int, c_int, c_int, c_int, c_int, c_uint, c_uint, *const c_void),
    tex_parameteri: unsafe extern "system" fn(c_uint, c_uint, c_int),
    read_pixels: unsafe extern "system" fn(c_int, c_int, c_int, c_int, c_uint, c_uint, *mut c_void),
    draw_arrays: unsafe extern "system" fn(c_uint, c_int, c_int),
    flush: unsafe extern "system" fn(),
    active_texture: unsafe extern "system" fn(c_uint),
    gen_framebuffers: unsafe extern "system" fn(c_int, *mut c_uint),
    delete_framebuffers: unsafe extern "system" fn(c_int, *const c_uint),
    bind_framebuffer: unsafe extern "system" fn(c_uint, c_uint),
    framebuffer_texture_2d: unsafe extern "system" fn(c_uint, c_uint, c_uint, c_uint, c_int),
    check_framebuffer_status: unsafe extern "system" fn(c_uint) -> c_uint,
    gen_buffers: unsafe extern "system" fn(c_int, *mut c_uint),
    delete_buffers: unsafe extern "system" fn(c_int, *const c_uint),
    bind_buffer: unsafe extern "system" fn(c_uint, c_uint),
    buffer_data: unsafe extern "system" fn(c_uint, isize, *const c_void, c_uint),
    map_buffer_range: unsafe extern "system" fn(c_uint, isize, isize, c_uint) -> *mut c_void,
    unmap_buffer: unsafe extern "system" fn(c_uint) -> u8,
    gen_vertex_arrays: unsafe extern "system" fn(c_int, *mut c_uint),
    delete_vertex_arrays: unsafe extern "system" fn(c_int, *const c_uint),
    bind_vertex_array: unsafe extern "system" fn(c_uint),
    create_shader: unsafe extern "system" fn(c_uint) -> c_uint,
    shader_source: unsafe extern "system" fn(c_uint, c_int, *const *const c_char, *const c_int),
    compile_shader: unsafe extern "system" fn(c_uint),
    get_shaderiv: unsafe extern "system" fn(c_uint, c_uint, *mut c_int),
    delete_shader: unsafe extern "system" fn(c_uint),
    create_program: unsafe extern "system" fn() -> c_uint,
    attach_shader: unsafe extern "system" fn(c_uint, c_uint),
    link_program: unsafe extern "system" fn(c_uint),
    get_programiv: unsafe extern "system" fn(c_uint, c_uint, *mut c_int),
    use_program: unsafe extern "system" fn(c_uint),
    delete_program: unsafe extern "system" fn(c_uint),
    get_uniform_location: unsafe extern "system" fn(c_uint, *const c_char) -> c_int,
    uniform_1i: unsafe extern "system" fn(c_int, c_int),
}

impl Gl {
    unsafe fn load() -> std::result::Result<Self, String> {
        macro_rules! proc_fn {
            ($name:literal) => {{
                let c = CStr::from_bytes_with_nul_unchecked($name);
                let p = mpv_get_gl_proc(null_mut(), c.as_ptr());
                if p.is_null() {
                    return Err(format!("missing GL proc {}", c.to_string_lossy()));
                }
                std::mem::transmute(p)
            }};
        }
        Ok(Self {
            viewport: proc_fn!(b"glViewport\0"),
            clear_color: proc_fn!(b"glClearColor\0"),
            clear: proc_fn!(b"glClear\0"),
            disable: proc_fn!(b"glDisable\0"),
            pixel_storei: proc_fn!(b"glPixelStorei\0"),
            gen_textures: proc_fn!(b"glGenTextures\0"),
            delete_textures: proc_fn!(b"glDeleteTextures\0"),
            bind_texture: proc_fn!(b"glBindTexture\0"),
            tex_image_2d: proc_fn!(b"glTexImage2D\0"),
            tex_parameteri: proc_fn!(b"glTexParameteri\0"),
            read_pixels: proc_fn!(b"glReadPixels\0"),
            draw_arrays: proc_fn!(b"glDrawArrays\0"),
            flush: proc_fn!(b"glFlush\0"),
            active_texture: proc_fn!(b"glActiveTexture\0"),
            gen_framebuffers: proc_fn!(b"glGenFramebuffers\0"),
            delete_framebuffers: proc_fn!(b"glDeleteFramebuffers\0"),
            bind_framebuffer: proc_fn!(b"glBindFramebuffer\0"),
            framebuffer_texture_2d: proc_fn!(b"glFramebufferTexture2D\0"),
            check_framebuffer_status: proc_fn!(b"glCheckFramebufferStatus\0"),
            gen_buffers: proc_fn!(b"glGenBuffers\0"),
            delete_buffers: proc_fn!(b"glDeleteBuffers\0"),
            bind_buffer: proc_fn!(b"glBindBuffer\0"),
            buffer_data: proc_fn!(b"glBufferData\0"),
            map_buffer_range: proc_fn!(b"glMapBufferRange\0"),
            unmap_buffer: proc_fn!(b"glUnmapBuffer\0"),
            gen_vertex_arrays: proc_fn!(b"glGenVertexArrays\0"),
            delete_vertex_arrays: proc_fn!(b"glDeleteVertexArrays\0"),
            bind_vertex_array: proc_fn!(b"glBindVertexArray\0"),
            create_shader: proc_fn!(b"glCreateShader\0"),
            shader_source: proc_fn!(b"glShaderSource\0"),
            compile_shader: proc_fn!(b"glCompileShader\0"),
            get_shaderiv: proc_fn!(b"glGetShaderiv\0"),
            delete_shader: proc_fn!(b"glDeleteShader\0"),
            create_program: proc_fn!(b"glCreateProgram\0"),
            attach_shader: proc_fn!(b"glAttachShader\0"),
            link_program: proc_fn!(b"glLinkProgram\0"),
            get_programiv: proc_fn!(b"glGetProgramiv\0"),
            use_program: proc_fn!(b"glUseProgram\0"),
            delete_program: proc_fn!(b"glDeleteProgram\0"),
            get_uniform_location: proc_fn!(b"glGetUniformLocation\0"),
            uniform_1i: proc_fn!(b"glUniform1i\0"),
        })
    }
}

const VS_QUAD: &str = "#version 330 core
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID & 1) * 4.0 - 1.0, (gl_VertexID & 2) * 2.0 - 1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}\0";

// Full-range BT.709 RGB -> Y (Y in [0, 1])
const FS_Y: &str = "#version 330 core
in vec2 vUv;
uniform sampler2D uTex;
out float outY;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  outY = clamp(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, 0.0, 1.0);
}\0";

// Full-range BT.709 4:2:0 averaged UV (U, V in [0, 1])
const FS_UV: &str = "#version 330 core
in vec2 vUv;
uniform sampler2D uTex;
out vec2 outUV;
void main() {
  ivec2 sz = textureSize(uTex, 0);
  ivec2 base = ivec2(gl_FragCoord.xy) * 2;
  vec3 c = (
    texelFetch(uTex, clamp(base + ivec2(0, 0), ivec2(0), sz - 1), 0).rgb +
    texelFetch(uTex, clamp(base + ivec2(1, 0), ivec2(0), sz - 1), 0).rgb +
    texelFetch(uTex, clamp(base + ivec2(0, 1), ivec2(0), sz - 1), 0).rgb +
    texelFetch(uTex, clamp(base + ivec2(1, 1), ivec2(0), sz - 1), 0).rgb
  ) * 0.25;
  float u = -0.114572 * c.r - 0.385428 * c.g + 0.5 * c.b + 0.5;
  float v = 0.5 * c.r - 0.454153 * c.g - 0.045847 * c.b + 0.5;
  outUV = clamp(vec2(u, v), 0.0, 1.0);
}\0";

unsafe fn build_program(gl: &Gl, fs_src: &str) -> std::result::Result<c_uint, String> {
    let vs = (gl.create_shader)(GL_VERTEX_SHADER);
    let vs_p = VS_QUAD.as_ptr() as *const c_char;
    (gl.shader_source)(vs, 1, &vs_p, null());
    (gl.compile_shader)(vs);
    let mut ok = 0;
    (gl.get_shaderiv)(vs, GL_COMPILE_STATUS, &mut ok);
    if ok == 0 {
        (gl.delete_shader)(vs);
        return Err("vertex shader compile failed".into());
    }

    let fs = (gl.create_shader)(GL_FRAGMENT_SHADER);
    let fs_p = fs_src.as_ptr() as *const c_char;
    (gl.shader_source)(fs, 1, &fs_p, null());
    (gl.compile_shader)(fs);
    (gl.get_shaderiv)(fs, GL_COMPILE_STATUS, &mut ok);
    if ok == 0 {
        (gl.delete_shader)(vs);
        (gl.delete_shader)(fs);
        return Err("fragment shader compile failed".into());
    }

    let prog = (gl.create_program)();
    (gl.attach_shader)(prog, vs);
    (gl.attach_shader)(prog, fs);
    (gl.link_program)(prog);
    (gl.get_programiv)(prog, GL_LINK_STATUS, &mut ok);
    (gl.delete_shader)(vs);
    (gl.delete_shader)(fs);
    if ok == 0 {
        (gl.delete_program)(prog);
        return Err("shader program link failed".into());
    }
    Ok(prog)
}

struct GlPipeline {
    hwnd: HWND,
    hdc: HDC,
    hglrc: HGLRC,
    gl: Gl,
    vao: c_uint,
    prog_y: c_uint,
    prog_uv: c_uint,
    main_fbo: c_uint,
    main_tex: c_uint,
    y_fbo: c_uint,
    y_tex: c_uint,
    uv_fbo: c_uint,
    uv_tex: c_uint,
    pbo_y: [c_uint; 2],
    pbo_uv: [c_uint; 2],
    pbo_rgba: [c_uint; 2],
    use_rgba: bool,
    w: i32,
    h: i32,
    slot: usize,
    slot_filled: [bool; 2],
}

impl GlPipeline {
    unsafe fn create_targets(gl: &Gl, w: i32, h: i32) -> std::result::Result<(c_uint, c_uint, c_uint, c_uint, c_uint, c_uint, [c_uint; 2], [c_uint; 2], [c_uint; 2], bool), String> {
        let make_rt = |tw: i32, th: i32, internal: c_uint, fmt: c_uint, linear: bool| -> std::result::Result<(c_uint, c_uint), String> {
            let mut tex = 0u32;
            let mut fbo = 0u32;
            (gl.gen_textures)(1, &mut tex);
            (gl.bind_texture)(GL_TEXTURE_2D, tex);
            let filt = if linear { GL_LINEAR } else { GL_NEAREST };
            (gl.tex_parameteri)(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, filt);
            (gl.tex_parameteri)(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, filt);
            (gl.tex_parameteri)(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
            (gl.tex_parameteri)(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
            (gl.tex_image_2d)(GL_TEXTURE_2D, 0, internal as c_int, tw, th, 0, fmt, GL_UNSIGNED_BYTE, null());
            (gl.gen_framebuffers)(1, &mut fbo);
            (gl.bind_framebuffer)(GL_FRAMEBUFFER, fbo);
            (gl.framebuffer_texture_2d)(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
            if (gl.check_framebuffer_status)(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE {
                (gl.delete_framebuffers)(1, &fbo);
                (gl.delete_textures)(1, &tex);
                return Err("incomplete FBO".into());
            }
            Ok((fbo, tex))
        };

        let (main_fbo, main_tex) = make_rt(w, h, GL_RGBA8, GL_RGBA, true)?;
        let use_rgba = (w as i64) * (h as i64) <= 2560 * 1440;
        let (y_fbo, y_tex, uv_fbo, uv_tex, pbo_y, pbo_uv, pbo_rgba) = if use_rgba {
            let mut p_rgba = [0u32; 2];
            (gl.gen_buffers)(2, p_rgba.as_mut_ptr());
            let rgba_bytes = (w as isize) * (h as isize) * 4;
            for i in 0..2 {
                (gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, p_rgba[i]);
                (gl.buffer_data)(GL_PIXEL_PACK_BUFFER, rgba_bytes, null(), GL_STREAM_READ);
            }
            (0, 0, 0, 0, [0u32; 2], [0u32; 2], p_rgba)
        } else {
            let (yf, yt) = match make_rt(w, h, GL_R8, GL_RED, false) {
                Ok(v) => v,
                Err(e) => {
                    (gl.delete_framebuffers)(1, &main_fbo);
                    (gl.delete_textures)(1, &main_tex);
                    return Err(e);
                }
            };
            let (uf, ut) = match make_rt(w / 2, h / 2, GL_RG8, GL_RG, false) {
                Ok(v) => v,
                Err(e) => {
                    (gl.delete_framebuffers)(1, &main_fbo);
                    (gl.delete_textures)(1, &main_tex);
                    (gl.delete_framebuffers)(1, &yf);
                    (gl.delete_textures)(1, &yt);
                    return Err(e);
                }
            };
            let mut py = [0u32; 2];
            let mut puv = [0u32; 2];
            (gl.gen_buffers)(2, py.as_mut_ptr());
            (gl.gen_buffers)(2, puv.as_mut_ptr());
            let y_bytes = (w as isize) * (h as isize);
            let uv_bytes = ((w / 2) as isize) * ((h / 2) as isize) * 2;
            for i in 0..2 {
                (gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, py[i]);
                (gl.buffer_data)(GL_PIXEL_PACK_BUFFER, y_bytes, null(), GL_STREAM_READ);
                (gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, puv[i]);
                (gl.buffer_data)(GL_PIXEL_PACK_BUFFER, uv_bytes, null(), GL_STREAM_READ);
            }
            (yf, yt, uf, ut, py, puv, [0u32; 2])
        };
        (gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, 0);
        (gl.bind_framebuffer)(GL_FRAMEBUFFER, 0);
        (gl.bind_texture)(GL_TEXTURE_2D, 0);
        Ok((main_fbo, main_tex, y_fbo, y_tex, uv_fbo, uv_tex, pbo_y, pbo_uv, pbo_rgba, use_rgba))
    }

    unsafe fn init(w: i32, h: i32) -> std::result::Result<Self, String> {
        let hwnd = CreateWindowExW(
            WS_EX_TOOLWINDOW,
            w!("STATIC"),
            w!("MajlisMpvGl"),
            WS_POPUP,
            0, 0, 1, 1,
            None, None, None, None,
        ).map_err(|e| format!("dummy hwnd: {e}"))?;
        let hdc = GetDC(Some(hwnd));
        if hdc.is_invalid() {
            let _ = DestroyWindow(hwnd);
            return Err("GetDC failed".into());
        }
        let pfd = PIXELFORMATDESCRIPTOR {
            nSize: std::mem::size_of::<PIXELFORMATDESCRIPTOR>() as u16,
            nVersion: 1,
            dwFlags: PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER,
            iPixelType: PFD_TYPE_RGBA,
            cColorBits: 24,
            cAlphaBits: 8,
            iLayerType: PFD_MAIN_PLANE.0 as u8,
            ..Default::default()
        };
        let pf = ChoosePixelFormat(hdc, &pfd);
        if pf == 0 || SetPixelFormat(hdc, pf, &pfd).is_err() {
            ReleaseDC(Some(hwnd), hdc);
            let _ = DestroyWindow(hwnd);
            return Err("SetPixelFormat failed".into());
        }
        let boot_glrc = wglCreateContext(hdc).map_err(|e| {
            ReleaseDC(Some(hwnd), hdc);
            let _ = DestroyWindow(hwnd);
            format!("wglCreateContext: {e}")
        })?;
        if wglMakeCurrent(hdc, boot_glrc).is_err() {
            let _ = wglDeleteContext(boot_glrc);
            ReleaseDC(Some(hwnd), hdc);
            let _ = DestroyWindow(hwnd);
            return Err("wglMakeCurrent failed".into());
        }

        type WglCreateAttribsFn = unsafe extern "system" fn(HDC, HGLRC, *const c_int) -> HGLRC;
        let create_attribs = wglGetProcAddress(windows::core::s!("wglCreateContextAttribsARB"));
        let hglrc = if let Some(p) = create_attribs {
            let f: WglCreateAttribsFn = std::mem::transmute(p);
            let attribs = [
                WGL_CONTEXT_MAJOR_VERSION_ARB, 3,
                WGL_CONTEXT_MINOR_VERSION_ARB, 3,
                WGL_CONTEXT_PROFILE_MASK_ARB, WGL_CONTEXT_CORE_PROFILE_BIT_ARB,
                0,
            ];
            let core_ctx = f(hdc, HGLRC::default(), attribs.as_ptr());
            if !core_ctx.is_invalid() && wglMakeCurrent(hdc, core_ctx).is_ok() {
                let _ = wglDeleteContext(boot_glrc);
                core_ctx
            } else {
                boot_glrc
            }
        } else {
            boot_glrc
        };

        let gl = match Gl::load() {
            Ok(g) => g,
            Err(e) => {
                let _ = wglMakeCurrent(HDC::default(), HGLRC::default());
                let _ = wglDeleteContext(hglrc);
                ReleaseDC(Some(hwnd), hdc);
                let _ = DestroyWindow(hwnd);
                return Err(e);
            }
        };

        let prog_y = build_program(&gl, FS_Y)?;
        let prog_uv = build_program(&gl, FS_UV)?;
        let mut vao = 0u32;
        (gl.gen_vertex_arrays)(1, &mut vao);

        let loc_y = (gl.get_uniform_location)(prog_y, b"uTex\0".as_ptr() as *const c_char);
        (gl.use_program)(prog_y);
        (gl.uniform_1i)(loc_y, 0);
        let loc_uv = (gl.get_uniform_location)(prog_uv, b"uTex\0".as_ptr() as *const c_char);
        (gl.use_program)(prog_uv);
        (gl.uniform_1i)(loc_uv, 0);
        (gl.use_program)(0);

        let (main_fbo, main_tex, y_fbo, y_tex, uv_fbo, uv_tex, pbo_y, pbo_uv, pbo_rgba, use_rgba) = Self::create_targets(&gl, w, h)?;
        Ok(Self {
            hwnd, hdc, hglrc, gl, vao, prog_y, prog_uv,
            main_fbo, main_tex, y_fbo, y_tex, uv_fbo, uv_tex, pbo_y, pbo_uv, pbo_rgba, use_rgba,
            w, h, slot: 0, slot_filled: [false, false],
        })
    }

    fn has_pending(&self) -> bool {
        self.slot_filled[0] || self.slot_filled[1]
    }

    fn latest_filled_slot(&self) -> Option<usize> {
        let newest = 1 - self.slot;
        if self.slot_filled[newest] {
            Some(newest)
        } else if self.slot_filled[self.slot] {
            Some(self.slot)
        } else {
            None
        }
    }

    unsafe fn destroy_targets(&mut self) {
        if self.use_rgba {
            if self.pbo_rgba[0] != 0 { (self.gl.delete_buffers)(2, self.pbo_rgba.as_ptr()); }
        } else {
            if self.pbo_y[0] != 0 { (self.gl.delete_buffers)(2, self.pbo_y.as_ptr()); }
            if self.pbo_uv[0] != 0 { (self.gl.delete_buffers)(2, self.pbo_uv.as_ptr()); }
            if self.y_fbo != 0 { (self.gl.delete_framebuffers)(1, &self.y_fbo); }
            if self.uv_fbo != 0 { (self.gl.delete_framebuffers)(1, &self.uv_fbo); }
            if self.y_tex != 0 { (self.gl.delete_textures)(1, &self.y_tex); }
            if self.uv_tex != 0 { (self.gl.delete_textures)(1, &self.uv_tex); }
        }
        (self.gl.delete_framebuffers)(1, &self.main_fbo);
        (self.gl.delete_textures)(1, &self.main_tex);
    }

    unsafe fn resize(&mut self, nw: i32, nh: i32) {
        if nw == self.w && nh == self.h {
            return;
        }
        self.destroy_targets();
        if let Ok((mf, mt, yf, yt, uf, ut, py, puv, prgba, ur)) = Self::create_targets(&self.gl, nw, nh) {
            self.main_fbo = mf; self.main_tex = mt;
            self.y_fbo = yf; self.y_tex = yt;
            self.uv_fbo = uf; self.uv_tex = ut;
            self.pbo_y = py; self.pbo_uv = puv;
            self.pbo_rgba = prgba; self.use_rgba = ur;
            self.w = nw; self.h = nh;
            self.slot = 0;
            self.slot_filled = [false, false];
        }
    }

    unsafe fn render_to_pbo(&mut self, api: &MpvApi, rctx: *mut mpv_render_context) {
        let mut fbo = mpv_opengl_fbo { fbo: self.main_fbo as c_int, w: self.w, h: self.h, internal_format: GL_RGBA8 as c_int };
        let mut flip_y: c_int = 0;
        let mut block: c_int = 0;
        let mut params = [
            mpv_render_param { param_type: MPV_RENDER_PARAM_OPENGL_FBO, data: &mut fbo as *mut _ as *mut c_void },
            mpv_render_param { param_type: MPV_RENDER_PARAM_FLIP_Y, data: &mut flip_y as *mut _ as *mut c_void },
            mpv_render_param { param_type: MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, data: &mut block as *mut _ as *mut c_void },
            mpv_render_param { param_type: MPV_RENDER_PARAM_INVALID, data: null_mut() },
        ];
        (self.gl.bind_framebuffer)(GL_FRAMEBUFFER, self.main_fbo);
        (self.gl.viewport)(0, 0, self.w, self.h);
        (self.gl.clear_color)(0.0, 0.0, 0.0, 1.0);
        (self.gl.clear)(GL_COLOR_BUFFER_BIT);
        (api.render_context_render)(rctx, params.as_mut_ptr());
        (self.gl.disable)(GL_DITHER);
        (self.gl.pixel_storei)(GL_PACK_ALIGNMENT, 1);
        (self.gl.pixel_storei)(0x0D02, 0);

        let cur = self.slot;
        if self.use_rgba {
            // Full 4:4:4 RGBA readback up to 1440p — re-bind main_fbo because libmpv switches FBOs during render
            (self.gl.bind_framebuffer)(GL_FRAMEBUFFER, self.main_fbo);
            (self.gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, self.pbo_rgba[cur]);
            (self.gl.read_pixels)(0, 0, self.w, self.h, GL_RGBA, GL_UNSIGNED_BYTE, null_mut());
        } else {
            // 4K NV12 2-pass conversion keeps IPC bandwidth 2.67x smaller at UHD resolutions
            (self.gl.bind_vertex_array)(self.vao);
            (self.gl.active_texture)(GL_TEXTURE0);
            (self.gl.bind_texture)(GL_TEXTURE_2D, self.main_tex);

            (self.gl.bind_framebuffer)(GL_FRAMEBUFFER, self.y_fbo);
            (self.gl.viewport)(0, 0, self.w, self.h);
            (self.gl.use_program)(self.prog_y);
            (self.gl.draw_arrays)(GL_TRIANGLES, 0, 3);
            (self.gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, self.pbo_y[cur]);
            (self.gl.read_pixels)(0, 0, self.w, self.h, GL_RED, GL_UNSIGNED_BYTE, null_mut());

            (self.gl.bind_framebuffer)(GL_FRAMEBUFFER, self.uv_fbo);
            (self.gl.viewport)(0, 0, self.w / 2, self.h / 2);
            (self.gl.use_program)(self.prog_uv);
            (self.gl.draw_arrays)(GL_TRIANGLES, 0, 3);
            (self.gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, self.pbo_uv[cur]);
            (self.gl.read_pixels)(0, 0, self.w / 2, self.h / 2, GL_RG, GL_UNSIGNED_BYTE, null_mut());
            (self.gl.use_program)(0);
            (self.gl.bind_vertex_array)(0);
        }

        (self.gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, 0);
        (self.gl.bind_framebuffer)(GL_FRAMEBUFFER, 0);
        (self.gl.flush)();
        (api.render_context_report_swap)(rctx);

        self.slot_filled[cur] = true;
        self.slot = 1 - cur;
    }

    unsafe fn read_slot_frame(&mut self, slot: usize) -> Option<(&'static str, Vec<u8>)> {
        if self.use_rgba {
            let bytes = (self.w as usize) * (self.h as usize) * 4;
            let mut out = vec![0u8; bytes];
            (self.gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, self.pbo_rgba[slot]);
            let p = (self.gl.map_buffer_range)(GL_PIXEL_PACK_BUFFER, 0, bytes as isize, GL_MAP_READ_BIT) as *const u8;
            if p.is_null() {
                (self.gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, 0);
                return None;
            }
            std::ptr::copy_nonoverlapping(p, out.as_mut_ptr(), bytes);
            (self.gl.unmap_buffer)(GL_PIXEL_PACK_BUFFER);
            (self.gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, 0);
            return Some(("rgba", out));
        }

        let y_bytes = (self.w * self.h) as usize;
        let uv_bytes = ((self.w / 2) * (self.h / 2) * 2) as usize;
        let mut out = vec![0u8; y_bytes + uv_bytes];

        (self.gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, self.pbo_y[slot]);
        let yp = (self.gl.map_buffer_range)(GL_PIXEL_PACK_BUFFER, 0, y_bytes as isize, GL_MAP_READ_BIT) as *const u8;
        if yp.is_null() {
            (self.gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, 0);
            return None;
        }
        std::ptr::copy_nonoverlapping(yp, out.as_mut_ptr(), y_bytes);
        (self.gl.unmap_buffer)(GL_PIXEL_PACK_BUFFER);

        (self.gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, self.pbo_uv[slot]);
        let uvp = (self.gl.map_buffer_range)(GL_PIXEL_PACK_BUFFER, 0, uv_bytes as isize, GL_MAP_READ_BIT) as *const u8;
        if uvp.is_null() {
            (self.gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, 0);
            return None;
        }
        std::ptr::copy_nonoverlapping(uvp, out.as_mut_ptr().add(y_bytes), uv_bytes);
        (self.gl.unmap_buffer)(GL_PIXEL_PACK_BUFFER);

        (self.gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, 0);
        Some(("nv12", out))
    }
}

impl Drop for GlPipeline {
    fn drop(&mut self) {
        unsafe {
            self.destroy_targets();
            (self.gl.delete_vertex_arrays)(1, &self.vao);
            (self.gl.delete_program)(self.prog_y);
            (self.gl.delete_program)(self.prog_uv);
            let _ = wglMakeCurrent(HDC::default(), HGLRC::default());
            let _ = wglDeleteContext(self.hglrc);
            ReleaseDC(Some(self.hwnd), self.hdc);
            let _ = DestroyWindow(self.hwnd);
        }
    }
}

// ------------------------------------------------------------------ Shared Player State
struct WakeSignal {
    dirty: Mutex<bool>,
    cv: Condvar,
}

unsafe extern "C" fn render_wakeup_cb(ctx: *mut c_void) {
    if ctx.is_null() {
        return;
    }
    let sig = &*(ctx as *const WakeSignal);
    if let Ok(mut d) = sig.dirty.lock() {
        *d = true;
        sig.cv.notify_one();
    }
}

pub struct FramePacket {
    pub w: u32,
    pub h: u32,
    pub fmt: &'static str,
    pub data: Vec<u8>,
}

fn clamp_size(w: u32, h: u32) -> (i32, i32) {
    let cw = (w.clamp(64, 3840) & !1) as i32;
    let ch = (h.clamp(64, 2160) & !1) as i32;
    (cw, ch)
}

fn try_acquire_slot(in_flight: &AtomicU32) -> bool {
    in_flight
        .try_update(Ordering::AcqRel, Ordering::Acquire, |v| if v < 2 { Some(v + 1) } else { None })
        .is_ok()
}

struct Shared {
    api: Arc<MpvApi>,
    ctx: *mut mpv_handle,
    stopping: AtomicBool,
    in_flight: AtomicU32,
    target_w: AtomicU32,
    target_h: AtomicU32,
    wake: Box<WakeSignal>,
}

unsafe impl Send for Shared {}
unsafe impl Sync for Shared {}

#[napi]
pub struct MpvPlayer {
    shared: Arc<Shared>,
    cmd_lock: Mutex<()>,
    render_thread: Mutex<Option<JoinHandle<()>>>,
    event_thread: Mutex<Option<JoinHandle<()>>>,
}

fn render_loop(
    shared: Arc<Shared>,
    on_frame: ThreadsafeFunction<FramePacket, ErrorStrategy::Fatal>,
    init_tx: std::sync::mpsc::SyncSender<std::result::Result<(), String>>,
) {
    unsafe {
        let (init_w, init_h) = clamp_size(shared.target_w.load(Ordering::Relaxed), shared.target_h.load(Ordering::Relaxed));
        let mut gl_pipe = GlPipeline::init(init_w, init_h).ok();
        let mut rctx: *mut mpv_render_context = null_mut();
        let mut use_sw = false;

        if gl_pipe.is_some() {
            let api_name = CString::new("opengl").unwrap();
            let mut gl_init = mpv_opengl_init_params {
                get_proc_address: Some(mpv_get_gl_proc),
                get_proc_address_ctx: null_mut(),
            };
            let mut adv: c_int = 1;
            let mut params = [
                mpv_render_param { param_type: MPV_RENDER_PARAM_API_TYPE, data: api_name.as_ptr() as *mut c_void },
                mpv_render_param { param_type: MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, data: &mut gl_init as *mut _ as *mut c_void },
                mpv_render_param { param_type: MPV_RENDER_PARAM_ADVANCED_CONTROL, data: &mut adv as *mut _ as *mut c_void },
                mpv_render_param { param_type: MPV_RENDER_PARAM_INVALID, data: null_mut() },
            ];
            let rc = (shared.api.render_context_create)(&mut rctx, shared.ctx, params.as_mut_ptr());
            if rc < 0 || rctx.is_null() {
                gl_pipe = None;
                rctx = null_mut();
            }
        }

        if rctx.is_null() {
            let api_name = CString::new("sw").unwrap();
            let mut adv: c_int = 1;
            let mut params = [
                mpv_render_param { param_type: MPV_RENDER_PARAM_API_TYPE, data: api_name.as_ptr() as *mut c_void },
                mpv_render_param { param_type: MPV_RENDER_PARAM_ADVANCED_CONTROL, data: &mut adv as *mut _ as *mut c_void },
                mpv_render_param { param_type: MPV_RENDER_PARAM_INVALID, data: null_mut() },
            ];
            let rc = (shared.api.render_context_create)(&mut rctx, shared.ctx, params.as_mut_ptr());
            if rc < 0 || rctx.is_null() {
                let _ = init_tx.send(Err(format!("mpv_render_context_create failed ({rc})")));
                return;
            }
            use_sw = true;
        }

        let sig_ptr = (&*shared.wake) as *const WakeSignal as *mut c_void;
        (shared.api.render_context_set_update_callback)(rctx, render_wakeup_cb, sig_ptr);
        let _ = init_tx.send(Ok(()));

        let _timer_guard = TimerPeriodGuard::new(1);
        let mut sw_buf: Vec<u8> = Vec::new();
        while !shared.stopping.load(Ordering::SeqCst) {
            let need_render = {
                let mut d = shared.wake.dirty.lock().unwrap();
                if !*d && !shared.stopping.load(Ordering::SeqCst) {
                    let wait = if gl_pipe.as_ref().map(|g| g.has_pending()).unwrap_or(false) { 1 } else { 100 };
                    let (guard, _) = shared.wake.cv.wait_timeout(d, std::time::Duration::from_millis(wait)).unwrap();
                    d = guard;
                }
                let was = *d;
                *d = false;
                was
            };
            if shared.stopping.load(Ordering::SeqCst) {
                break;
            }

            let (rw, rh) = clamp_size(shared.target_w.load(Ordering::Relaxed), shared.target_h.load(Ordering::Relaxed));
            if let Some(gp) = gl_pipe.as_mut() {
                let was_w = gp.w;
                let was_h = gp.h;
                gp.resize(rw, rh);
                let flags = (shared.api.render_context_update)(rctx);
                if (flags & MPV_RENDER_UPDATE_FRAME) != 0 || (need_render && (was_w != rw || was_h != rh)) {
                    let cur_slot = gp.slot;
                    let prev_slot = 1 - cur_slot;
                    let prev_ready = gp.slot_filled[prev_slot];
                    gp.render_to_pbo(&shared.api, rctx);
                    // Overlap up to 2 frames cleanly: drain previous completed PBO while GPU processes newly submitted slot
                    if prev_ready && try_acquire_slot(&shared.in_flight) {
                        if let Some((fmt, data)) = gp.read_slot_frame(prev_slot) {
                            gp.slot_filled[prev_slot] = false;
                            on_frame.call(FramePacket { w: gp.w as u32, h: gp.h as u32, fmt, data }, ThreadsafeFunctionCallMode::NonBlocking);
                        } else {
                            let _ = shared.in_flight.try_update(Ordering::AcqRel, Ordering::Acquire, |v| Some(v.saturating_sub(1)));
                        }
                    }
                } else if let Some(flush_slot) = gp.latest_filled_slot() {
                    if try_acquire_slot(&shared.in_flight) {
                        if let Some((fmt, data)) = gp.read_slot_frame(flush_slot) {
                            gp.slot_filled[flush_slot] = false;
                            on_frame.call(FramePacket { w: gp.w as u32, h: gp.h as u32, fmt, data }, ThreadsafeFunctionCallMode::NonBlocking);
                        } else {
                            let _ = shared.in_flight.try_update(Ordering::AcqRel, Ordering::Acquire, |v| Some(v.saturating_sub(1)));
                        }
                    }
                }
            } else if use_sw {
                let flags = (shared.api.render_context_update)(rctx);
                if (flags & MPV_RENDER_UPDATE_FRAME) != 0 {
                    let stride: usize = (rw as usize) * 4;
                    let need = stride * (rh as usize);
                    if sw_buf.len() != need {
                        sw_buf.resize(need, 0);
                    }
                    let mut size = [rw, rh];
                    let fmt = CString::new("bgr0").unwrap();
                    let mut st = stride;
                    let mut block: c_int = 0;
                    let mut params = [
                        mpv_render_param { param_type: MPV_RENDER_PARAM_SW_SIZE, data: size.as_mut_ptr() as *mut c_void },
                        mpv_render_param { param_type: MPV_RENDER_PARAM_SW_FORMAT, data: fmt.as_ptr() as *mut c_void },
                        mpv_render_param { param_type: MPV_RENDER_PARAM_SW_STRIDE, data: &mut st as *mut _ as *mut c_void },
                        mpv_render_param { param_type: MPV_RENDER_PARAM_SW_POINTER, data: sw_buf.as_mut_ptr() as *mut c_void },
                        mpv_render_param { param_type: MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, data: &mut block as *mut _ as *mut c_void },
                        mpv_render_param { param_type: MPV_RENDER_PARAM_INVALID, data: null_mut() },
                    ];
                    if (shared.api.render_context_render)(rctx, params.as_mut_ptr()) >= 0
                        && try_acquire_slot(&shared.in_flight)
                    {
                        on_frame.call(FramePacket { w: rw as u32, h: rh as u32, fmt: "bgra", data: sw_buf.clone() }, ThreadsafeFunctionCallMode::NonBlocking);
                    }
                    (shared.api.render_context_report_swap)(rctx);
                }
            }
        }

        (shared.api.render_context_set_update_callback)(rctx, noop_wakeup_cb, null_mut());
        (shared.api.render_context_free)(rctx);
        drop(gl_pipe);
    }
}

unsafe extern "C" fn noop_wakeup_cb(_ctx: *mut c_void) {}

fn event_loop(shared: Arc<Shared>, on_event: ThreadsafeFunction<String, ErrorStrategy::Fatal>) {
    unsafe {
        while !shared.stopping.load(Ordering::SeqCst) {
            let ev = (shared.api.wait_event)(shared.ctx, 0.2);
            if ev.is_null() {
                continue;
            }
            let e = &*ev;
            match e.event_id {
                MPV_EVENT_NONE => {}
                MPV_EVENT_SHUTDOWN => {
                    on_event.call(json!({ "event": "shutdown" }).to_string(), ThreadsafeFunctionCallMode::NonBlocking);
                    break;
                }
                MPV_EVENT_START_FILE => {
                    on_event.call(json!({ "event": "start-file" }).to_string(), ThreadsafeFunctionCallMode::NonBlocking);
                }
                MPV_EVENT_FILE_LOADED => {
                    on_event.call(json!({ "event": "file-loaded" }).to_string(), ThreadsafeFunctionCallMode::NonBlocking);
                }
                MPV_EVENT_END_FILE => {
                    let ef = if !e.data.is_null() { &*(e.data as *const mpv_event_end_file) } else { continue };
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
impl MpvPlayer {
    #[napi(constructor)]
    pub fn new(
        env: Env,
        dll_path: String,
        options: Vec<(String, String)>,
        watched_props: Vec<String>,
        width: u32,
        height: u32,
        on_event: JsFunction,
        on_frame: JsFunction,
    ) -> Result<Self> {
        let mut ev_cb: ThreadsafeFunction<String, ErrorStrategy::Fatal> =
            on_event.create_threadsafe_function(0, |ctx: ThreadSafeCallContext<String>| {
                Ok(vec![ctx.env.create_string(&ctx.value)?.into_unknown()])
            })?;
        ev_cb.unref(&env)?;

        let mut fr_cb: ThreadsafeFunction<FramePacket, ErrorStrategy::Fatal> =
            on_frame.create_threadsafe_function(0, |ctx: ThreadSafeCallContext<FramePacket>| {
                let p = ctx.value;
                Ok(vec![
                    ctx.env.create_uint32(p.w)?.into_unknown(),
                    ctx.env.create_uint32(p.h)?.into_unknown(),
                    ctx.env.create_string(p.fmt)?.into_unknown(),
                    ctx.env.create_buffer_with_data(p.data)?.into_raw().into_unknown(),
                ])
            })?;
        fr_cb.unref(&env)?;

        let api = Arc::new(MpvApi::load(&dll_path).map_err(Error::from_reason)?);
        let ctx = unsafe { (api.create)() };
        if ctx.is_null() {
            return Err(Error::from_reason("mpv_create returned null"));
        }

        unsafe {
            for (k, v) in options {
                if let (Ok(ck), Ok(cv)) = (CString::new(k), CString::new(v)) {
                    (api.set_option_string)(ctx, ck.as_ptr(), cv.as_ptr());
                }
            }
            let rc = (api.initialize)(ctx);
            if rc < 0 {
                (api.terminate_destroy)(ctx);
                return Err(Error::from_reason(format!("mpv_initialize failed ({rc})")));
            }
            for (i, prop) in watched_props.iter().enumerate() {
                if let Ok(cp) = CString::new(prop.as_str()) {
                    (api.observe_property)(ctx, (i + 1) as c_ulonglong, cp.as_ptr(), MPV_FORMAT_NODE);
                }
            }
        }

        let (cw, ch) = clamp_size(width, height);
        let shared = Arc::new(Shared {
            api,
            ctx,
            stopping: AtomicBool::new(false),
            in_flight: AtomicU32::new(0),
            target_w: AtomicU32::new(cw as u32),
            target_h: AtomicU32::new(ch as u32),
            wake: Box::new(WakeSignal {
                dirty: Mutex::new(false),
                cv: Condvar::new(),
            }),
        });

        let (init_tx, init_rx) = std::sync::mpsc::sync_channel(1);
        let s_render = shared.clone();
        let render_handle = thread::Builder::new()
            .name("mpv-gl-render".into())
            .spawn(move || render_loop(s_render, fr_cb, init_tx))
            .map_err(|e| Error::from_reason(format!("spawn render thread: {e}")))?;

        match init_rx.recv() {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                shared.stopping.store(true, Ordering::SeqCst);
                let _ = render_handle.join();
                unsafe { (shared.api.terminate_destroy)(shared.ctx); }
                return Err(Error::from_reason(e));
            }
            Err(e) => {
                shared.stopping.store(true, Ordering::SeqCst);
                let _ = render_handle.join();
                unsafe { (shared.api.terminate_destroy)(shared.ctx); }
                return Err(Error::from_reason(format!("render init interrupted: {e}")));
            }
        }

        let s_event = shared.clone();
        let event_handle = thread::Builder::new()
            .name("mpv-events".into())
            .spawn(move || event_loop(s_event, ev_cb))
            .map_err(|e| Error::from_reason(format!("spawn event thread: {e}")))?;

        Ok(Self {
            shared,
            cmd_lock: Mutex::new(()),
            render_thread: Mutex::new(Some(render_handle)),
            event_thread: Mutex::new(Some(event_handle)),
        })
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
    pub fn resize(&self, w: u32, h: u32) {
        let (cw, ch) = clamp_size(w, h);
        self.shared.target_w.store(cw as u32, Ordering::Relaxed);
        self.shared.target_h.store(ch as u32, Ordering::Relaxed);
        if let Ok(mut d) = self.shared.wake.dirty.lock() {
            *d = true;
            self.shared.wake.cv.notify_one();
        }
    }

    #[napi]
    pub fn ack_frame(&self) {
        let _ = self.shared.in_flight.try_update(Ordering::AcqRel, Ordering::Acquire, |v| Some(v.saturating_sub(1)));
        if let Ok(mut d) = self.shared.wake.dirty.lock() {
            *d = true;
            self.shared.wake.cv.notify_one();
        }
    }

    #[napi]
    pub fn destroy(&self) {
        let _g = self.cmd_lock.lock().unwrap();
        if self.shared.stopping.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Ok(mut d) = self.shared.wake.dirty.lock() {
            *d = true;
            self.shared.wake.cv.notify_all();
        }
        if let Some(h) = self.render_thread.lock().unwrap().take() {
            let _ = h.join();
        }
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
    }
}

impl Drop for MpvPlayer {
    fn drop(&mut self) {
        self.destroy();
    }
}
