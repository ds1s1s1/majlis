using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Text;
using Vortice.DXGI;
using static Majlis.Native;

namespace Majlis;

static class Windows
{
    public record Win(long hwnd, string title, string exe, string path, int pid, int x, int y, int w, int h);

    public static List<Win> List()
    {
        var list = new List<Win>();
        int self = Environment.ProcessId;
        EnumWindows((h, _) =>
        {
            if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true; // skip owned windows
            int ex = GetWindowLong(h, -20);
            if ((ex & 0x80) != 0) return true; // tool windows
            DwmGetWindowAttribute(h, 14, out int cloaked, 4);
            if (cloaked != 0) return true;
            int len = GetWindowTextLength(h);
            if (len == 0) return true;
            var sb = new StringBuilder(len + 1);
            GetWindowText(h, sb, sb.Capacity);
            GetWindowThreadProcessId(h, out uint pid);
            if (pid == self) return true;
            string exe = "", path = "";
            try { var p = Process.GetProcessById((int)pid); exe = p.ProcessName; path = p.MainModule?.FileName ?? ""; } catch { }
            if (exe is "TextInputHost" or "ApplicationFrameHost" or "SystemSettings" or "ShellExperienceHost") return true;
            DwmGetWindowAttribute(h, 9, out RECT r, 16);
            list.Add(new Win(h.ToInt64(), sb.ToString(), exe, path, (int)pid, r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top));
            return true;
        }, IntPtr.Zero);
        return list;
    }

    public static void Focus(long hwnd)
    {
        var h = new IntPtr(hwnd);
        if (IsIconic(h)) ShowWindow(h, 9);
        SetForegroundWindow(h);
    }

    public static string IconPng(string path)
    {
        try
        {
            using var icon = Icon.ExtractAssociatedIcon(path);
            if (icon == null) return null;
            using var bmp = new Bitmap(icon.ToBitmap(), 64, 64);
            using var ms = new MemoryStream();
            bmp.Save(ms, ImageFormat.Png);
            return Convert.ToBase64String(ms.ToArray());
        }
        catch { return null; }
    }
}

static class Displays
{
    public record Disp(int index, string name, int x, int y, int w, int h, int hz, bool primary, bool hdr, string adapter);
    static readonly Dictionary<string, DEVMODE> saved = new();

    // Same order ddagrab uses: outputs of the first adapter.
    public static List<Disp> List()
    {
        var list = new List<Disp>();
        using var f = DXGI.CreateDXGIFactory1<IDXGIFactory1>();
        if (f.EnumAdapters1(0, out var adapter).Failure) return list;
        using (adapter)
        {
            string aname = adapter.Description1.Description;
            for (uint i = 0; adapter.EnumOutputs(i, out var output).Success; i++)
            {
                using (output)
                {
                    var d = output.Description;
                    bool hdr = false;
                    try { using var o6 = output.QueryInterface<IDXGIOutput6>(); hdr = o6.Description1.ColorSpace == ColorSpaceType.RgbFullG2084NoneP2020; } catch { }
                    var dm = new DEVMODE { dmSize = (short)System.Runtime.InteropServices.Marshal.SizeOf<DEVMODE>() };
                    EnumDisplaySettings(d.DeviceName, ENUM_CURRENT_SETTINGS, ref dm);
                    var r = d.DesktopCoordinates;
                    list.Add(new Disp((int)i, d.DeviceName, r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top, dm.dmDisplayFrequency, r.Left == 0 && r.Top == 0, hdr, aname));
                }
            }
        }
        return list;
    }

    // Match the host screen to the viewer's resolution/refresh so nothing gets scaled.
    public static bool SetMode(int index, int w, int h, int hz)
    {
        var d = List().FirstOrDefault(x => x.index == index);
        if (d == null) return false;
        var cur = new DEVMODE { dmSize = (short)System.Runtime.InteropServices.Marshal.SizeOf<DEVMODE>() };
        if (!EnumDisplaySettings(d.name, ENUM_CURRENT_SETTINGS, ref cur)) return false;
        if (!saved.ContainsKey(d.name)) saved[d.name] = cur;
        // find a supported mode; prefer the requested refresh, else the highest available
        DEVMODE best = default; bool found = false;
        var m = new DEVMODE { dmSize = cur.dmSize };
        for (int i = 0; EnumDisplaySettings(d.name, i, ref m); i++)
        {
            if (m.dmPelsWidth != w || m.dmPelsHeight != h) continue;
            if (!found || (hz > 0 && Math.Abs(m.dmDisplayFrequency - hz) < Math.Abs(best.dmDisplayFrequency - hz)) || (hz == 0 && m.dmDisplayFrequency > best.dmDisplayFrequency)) { best = m; found = true; }
        }
        if (!found) return false;
        best.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY;
        return ChangeDisplaySettingsEx(d.name, ref best, IntPtr.Zero, CDS_FULLSCREEN, IntPtr.Zero) == 0;
    }

    public static void RestoreAll()
    {
        foreach (var (name, _) in saved) ChangeDisplaySettingsEx(name, IntPtr.Zero, IntPtr.Zero, 0, IntPtr.Zero);
        saved.Clear();
    }
}
