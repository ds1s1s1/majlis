using System.Drawing;
using System.Drawing.Imaging;
using static Majlis.Native;

namespace Majlis;

// The stream is captured without the mouse pointer; the viewer draws it locally instead,
// so moving the mouse feels instant even when the video is a few frames behind.
static class Cursor
{
    static Thread thread;
    static volatile bool run;
    static int rx, ry, rw = 1920, rh = 1080;
    static readonly Dictionary<IntPtr, int> shapes = new();

    public static void SetRect(int x, int y, int w, int h) { rx = x; ry = y; rw = Math.Max(1, w); rh = Math.Max(1, h); }

    public static void Start()
    {
        if (run) return;
        run = true;
        thread = new Thread(Loop) { IsBackground = true, Priority = ThreadPriority.AboveNormal };
        thread.Start();
    }
    public static void Stop() => run = false;

    static void Loop()
    {
        float lx = -1, ly = -1; bool lv = false; IntPtr lh = IntPtr.Zero;
        var pkt = new byte[13];
        while (run)
        {
            var ci = new CURSORINFO { cbSize = System.Runtime.InteropServices.Marshal.SizeOf<CURSORINFO>() };
            if (GetCursorInfo(ref ci))
            {
                bool vis = (ci.flags & 1) != 0;
                float x = (ci.pt.X - rx) / (float)rw, y = (ci.pt.Y - ry) / (float)rh;
                if (vis && ci.hCursor != lh) { Shape(ci.hCursor); lh = ci.hCursor; }
                if (x != lx || y != ly || vis != lv)
                {
                    BitConverter.TryWriteBytes(pkt.AsSpan(0), x);
                    BitConverter.TryWriteBytes(pkt.AsSpan(4), y);
                    pkt[8] = (byte)(vis ? 1 : 0);
                    BitConverter.TryWriteBytes(pkt.AsSpan(9), shapes.TryGetValue(lh, out var id) ? id : 0);
                    Program.Send(3, pkt);
                    lx = x; ly = y; lv = vis;
                }
            }
            Thread.Sleep(4);
        }
    }

    static void Shape(IntPtr h)
    {
        if (shapes.ContainsKey(h)) return;
        int id = shapes.Count + 1;
        shapes[h] = id;
        try
        {
            IntPtr copy = CopyIcon(h);
            GetIconInfo(copy, out var ii);
            using var icon = Icon.FromHandle(copy);
            using var bmp = icon.ToBitmap();
            using var ms = new MemoryStream();
            bmp.Save(ms, ImageFormat.Png);
            if (ii.hbmMask != IntPtr.Zero) DeleteObject(ii.hbmMask);
            if (ii.hbmColor != IntPtr.Zero) DeleteObject(ii.hbmColor);
            DestroyIcon(copy);
            Program.Event("cursor_shape", new { id, png = Convert.ToBase64String(ms.ToArray()), hx = ii.xHotspot, hy = ii.yHotspot, w = bmp.Width, h = bmp.Height });
        }
        catch { }
    }
}
