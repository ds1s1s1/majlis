using System.Runtime.InteropServices;
using System.Text.Json.Nodes;
using static Majlis.Native;

namespace Majlis;

// Keyboard and mouse injection. Keys go in as scan codes so games that read raw input or
// DirectInput see them the same as a real keyboard.
static class Input
{
    static int rx, ry, rw = 1920, rh = 1080;
    static readonly HashSet<(ushort, bool)> heldKeys = new();
    static readonly HashSet<int> heldButtons = new();
    static readonly int Size = Marshal.SizeOf<INPUT>();

    public static void SetRect(int x, int y, int w, int h) { rx = x; ry = y; rw = Math.Max(1, w); rh = Math.Max(1, h); }

    public static void Apply(JsonArray events)
    {
        var list = new List<INPUT>(events.Count);
        foreach (var e in events)
        {
            var a = e.AsArray();
            int t = (int)a[0];
            switch (t)
            {
                case 1: // key: down, scancode, extended
                {
                    bool down = (int)a[1] != 0; ushort sc = (ushort)(int)a[2]; bool ext = (int)a[3] != 0;
                    uint f = KEYEVENTF_SCANCODE | (ext ? KEYEVENTF_EXTENDEDKEY : 0) | (down ? 0 : KEYEVENTF_KEYUP);
                    if (down) heldKeys.Add((sc, ext)); else heldKeys.Remove((sc, ext));
                    list.Add(new INPUT { type = INPUT_KEYBOARD, u = new InputUnion { ki = new KEYBDINPUT { wScan = sc, dwFlags = f } } });
                    break;
                }
                case 2: // relative move
                    list.Add(Mouse((int)a[1], (int)a[2], MOUSEEVENTF_MOVE, 0));
                    break;
                case 3: // absolute, 0..65535 inside the captured area
                {
                    double nx = (int)a[1] / 65535.0, ny = (int)a[2] / 65535.0;
                    int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
                    double px = rx + nx * (rw - 1), py = ry + ny * (rh - 1);
                    int ax = (int)Math.Round((px - vx) * 65535.0 / Math.Max(1, vw - 1));
                    int ay = (int)Math.Round((py - vy) * 65535.0 / Math.Max(1, vh - 1));
                    list.Add(Mouse(ax, ay, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, 0));
                    break;
                }
                case 4: // button
                {
                    int b = (int)a[1]; bool down = (int)a[2] != 0;
                    if (down) heldButtons.Add(b); else heldButtons.Remove(b);
                    list.Add(Button(b, down));
                    break;
                }
                case 5: // wheel
                {
                    int dy = (int)a[1], dx = (int)a[2];
                    if (dy != 0) list.Add(Mouse(0, 0, MOUSEEVENTF_WHEEL, dy));
                    if (dx != 0) list.Add(Mouse(0, 0, MOUSEEVENTF_HWHEEL, dx));
                    break;
                }
            }
        }
        if (list.Count > 0) SendInput((uint)list.Count, list.ToArray(), Size);
    }

    static INPUT Mouse(int dx, int dy, uint flags, int data) =>
        new() { type = INPUT_MOUSE, u = new InputUnion { mi = new MOUSEINPUT { dx = dx, dy = dy, dwFlags = flags, mouseData = data } } };

    static INPUT Button(int b, bool down)
    {
        uint f; int data = 0;
        switch (b)
        {
            case 0: f = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP; break;
            case 1: f = down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP; break;
            case 2: f = down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP; break;
            case 3: f = down ? MOUSEEVENTF_XDOWN : MOUSEEVENTF_XUP; data = 1; break;
            default: f = down ? MOUSEEVENTF_XDOWN : MOUSEEVENTF_XUP; data = 2; break;
        }
        return Mouse(0, 0, f, data);
    }

    // Panic button / guest left: let go of everything so nothing stays stuck down.
    public static void ReleaseAll()
    {
        var list = new List<INPUT>();
        foreach (var (sc, ext) in heldKeys)
            list.Add(new INPUT { type = INPUT_KEYBOARD, u = new InputUnion { ki = new KEYBDINPUT { wScan = sc, dwFlags = KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP | (ext ? KEYEVENTF_EXTENDEDKEY : 0) } } });
        foreach (var b in heldButtons) list.Add(Button(b, false));
        heldKeys.Clear(); heldButtons.Clear();
        if (list.Count > 0) SendInput((uint)list.Count, list.ToArray(), Size);
    }
}
