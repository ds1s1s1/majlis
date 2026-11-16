using System.IO.Pipes;
using System.Runtime.InteropServices;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using WinRT;

namespace Majlis;

// "Only the game window": Windows Graphics Capture of one window, so toasts, Discord and
// WhatsApp popups on the host's screen never show up on the friend's side.
// Frames are copied to a fixed-size buffer and written to a named pipe ffmpeg reads from.
static class WindowCapture
{
    [ComImport, Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IGraphicsCaptureItemInterop
    {
        IntPtr CreateForWindow([In] IntPtr window, [In] ref Guid iid);
        IntPtr CreateForMonitor([In] IntPtr monitor, [In] ref Guid iid);
    }

    [ComImport, Guid("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDirect3DDxgiInterfaceAccess { IntPtr GetInterface([In] ref Guid iid); }

    [DllImport("d3d11.dll")] static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgi, out IntPtr graphics);

    public static bool Supported { get { try { return GraphicsCaptureSession.IsSupported(); } catch { return false; } } }

    static ID3D11Device dev; static ID3D11DeviceContext ctx;
    static Direct3D11CaptureFramePool pool; static GraphicsCaptureSession session;
    static ID3D11Texture2D staging;
    static NamedPipeServerStream pipe;
    static int W, H;
    static byte[] frameBuf; static readonly object frameLock = new();
    static Thread writer; static volatile bool running;

    public static void Start(long hwnd, int fps, string pipeName)
    {
        Stop();
        var h = new IntPtr(hwnd);
        if (!Native.IsWindow(h) || !Native.IsWindowVisible(h)) throw new Exception("window is closed or hidden");
        // a minimized window has nothing to capture; bring it back first
        if (Native.IsIconic(h)) { Native.ShowWindow(h, 9); Thread.Sleep(250); }
        D3D11.D3D11CreateDevice(null, DriverType.Hardware, DeviceCreationFlags.BgraSupport, new[] { FeatureLevel.Level_11_0 }, out dev, out ctx).CheckError();
        using var dxgi = dev.QueryInterface<IDXGIDevice>();
        CreateDirect3D11DeviceFromDXGIDevice(dxgi.NativePointer, out var gptr);
        var winrtDev = MarshalInterface<IDirect3DDevice>.FromAbi(gptr);
        Marshal.Release(gptr);

        var interop = GraphicsCaptureItem.As<IGraphicsCaptureItemInterop>();
        var iid = new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760");
        var itemPtr = interop.CreateForWindow(new IntPtr(hwnd), ref iid);
        var item = GraphicsCaptureItem.FromAbi(itemPtr);
        Marshal.Release(itemPtr);

        W = item.Size.Width & ~1; H = item.Size.Height & ~1;
        if (W < 64 || H < 64) throw new Exception("window too small");
        staging = dev.CreateTexture2D(new Texture2DDescription
        {
            Width = (uint)W, Height = (uint)H, MipLevels = 1, ArraySize = 1, Format = Format.B8G8R8A8_UNorm,
            SampleDescription = new SampleDescription(1, 0), Usage = ResourceUsage.Staging, CPUAccessFlags = CpuAccessFlags.Read,
        });
        frameBuf = new byte[W * H * 4];

        pool = Direct3D11CaptureFramePool.CreateFreeThreaded(winrtDev, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, item.Size);
        session = pool.CreateCaptureSession(item);
        try { session.IsCursorCaptureEnabled = false; } catch { }
        try { session.IsBorderRequired = false; } catch { }
        pool.FrameArrived += OnFrame;

        PipeName = pipeName;
        running = true;
        session.StartCapture();

        // Several readers can be connected at once: when the app swaps encoders (new bitrate,
        // keyframe request) the replacement ffmpeg reads alongside the old one until it takes over.
        acceptor = new Thread(() =>
        {
            while (running)
            {
                var s = new NamedPipeServerStream(pipeName, PipeDirection.Out, NamedPipeServerStream.MaxAllowedServerInstances, PipeTransmissionMode.Byte, PipeOptions.None, 0, W * H * 4);
                try { s.WaitForConnection(); } catch { s.Dispose(); break; }
                if (!running) { s.Dispose(); break; }
                lock (clients) clients.Add(s);
            }
        }) { IsBackground = true };
        acceptor.Start();
        Program.Event("wincap", new { ok = true, w = W, h = H, pipe = @"\\.\pipe\" + pipeName });

        writer = new Thread(() =>
        {
            var local = new byte[frameBuf.Length];
            long interval = TimeSpan.TicksPerSecond / fps, next = DateTime.UtcNow.Ticks;
            while (running)
            {
                NamedPipeServerStream[] list;
                lock (clients) list = clients.ToArray();
                if (list.Length > 0)
                {
                    // constant frame rate for the encoder: repeat the last frame if nothing changed
                    lock (frameLock) Buffer.BlockCopy(frameBuf, 0, local, 0, local.Length);
                    foreach (var c in list)
                    {
                        try { c.Write(local, 0, local.Length); }
                        catch { lock (clients) clients.Remove(c); try { c.Dispose(); } catch { } } // that ffmpeg went away
                    }
                }
                next += interval;
                long wait = next - DateTime.UtcNow.Ticks;
                if (wait > 0) Thread.Sleep(TimeSpan.FromTicks(wait)); else next = DateTime.UtcNow.Ticks;
            }
        }) { IsBackground = true, Priority = ThreadPriority.AboveNormal };
        writer.Start();
    }

    static readonly List<NamedPipeServerStream> clients = new();
    static Thread acceptor;
    static string PipeName;

    static void OnFrame(Direct3D11CaptureFramePool p, object _)
    {
        using var frame = p.TryGetNextFrame();
        if (frame == null || !running) return;
        var access = frame.Surface.As<IDirect3DDxgiInterfaceAccess>();
        var tid = typeof(ID3D11Texture2D).GUID;
        var texPtr = access.GetInterface(ref tid);
        using var tex = new ID3D11Texture2D(texPtr);
        var d = tex.Description;
        uint cw = Math.Min((uint)W, d.Width), ch = Math.Min((uint)H, d.Height);
        ctx.CopySubresourceRegion(staging, 0, 0, 0, 0, tex, 0, new Vortice.Mathematics.Box(0, 0, 0, (int)cw, (int)ch, 1));
        var map = ctx.Map(staging, 0, MapMode.Read);
        lock (frameLock)
        {
            unsafe
            {
                byte* src = (byte*)map.DataPointer;
                fixed (byte* dst = frameBuf)
                    for (int y = 0; y < H; y++) Buffer.MemoryCopy(src + y * map.RowPitch, dst + y * W * 4, W * 4, W * 4);
            }
        }
        ctx.Unmap(staging, 0);
    }

    public static void Stop()
    {
        bool was = running;
        running = false;
        try { session?.Dispose(); } catch { }
        try { pool?.Dispose(); } catch { }
        try { pipe?.Dispose(); } catch { }
        lock (clients) { foreach (var c in clients) try { c.Dispose(); } catch { } clients.Clear(); }
        // wake the acceptor out of WaitForConnection
        if (was && PipeName != null) try { using var poke = new NamedPipeClientStream(".", PipeName, PipeDirection.In); poke.Connect(200); } catch { }
        try { staging?.Dispose(); ctx?.Dispose(); dev?.Dispose(); } catch { }
        session = null; pool = null; pipe = null; staging = null; ctx = null; dev = null;
    }
}
