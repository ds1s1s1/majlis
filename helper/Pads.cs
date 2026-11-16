using System.Text.Json.Nodes;
using Nefarius.ViGEm.Client;
using Nefarius.ViGEm.Client.Targets;
using Nefarius.ViGEm.Client.Targets.DualShock4;
using Nefarius.ViGEm.Client.Targets.Xbox360;

namespace Majlis;

// Virtual controllers, one per player slot. Needs the ViGEmBus driver.
// DualSense owners get an emulated DualShock 4 so gyro, touchpad and rumble still work.
static class Pads
{
    static ViGEmClient client;
    public static string Error;
    static readonly Dictionary<int, IVirtualGamepad> pads = new();
    static readonly Dictionary<int, byte[]> ds4State = new();
    static ushort ds4Clock;

    public static bool Available
    {
        get
        {
            if (client != null) return true;
            try { client = new ViGEmClient(); Error = null; return true; }
            catch (Exception e) { Error = e.GetType().Name; return false; }
        }
    }

    public static void Add(int slot, string type)
    {
        if (!Available) { Program.Event("pad_added", new { slot, ok = false, error = Error }); return; }
        Remove(slot);
        IVirtualGamepad pad;
        if (type == "ds4")
        {
            var d = client.CreateDualShock4Controller();
            d.AutoSubmitReport = false;
            d.FeedbackReceived += (s, e) => Program.Event("rumble", new { slot, large = (int)e.LargeMotor, small = (int)e.SmallMotor });
            pad = d;
            var st = new byte[63];
            st[0] = st[1] = st[2] = st[3] = 0x80; st[4] = 0x08;
            ds4State[slot] = st;
        }
        else
        {
            var x = client.CreateXbox360Controller();
            x.AutoSubmitReport = false;
            x.FeedbackReceived += (s, e) => Program.Event("rumble", new { slot, large = (int)e.LargeMotor, small = (int)e.SmallMotor });
            pad = x;
        }
        pad.Connect();
        pads[slot] = pad;
        Program.Event("pad_added", new { slot, ok = true, type });
    }

    public static void Remove(int slot)
    {
        if (pads.Remove(slot, out var p)) { try { p.Disconnect(); } catch { } }
        ds4State.Remove(slot);
    }

    public static void RemoveAll() { foreach (var s in pads.Keys.ToList()) Remove(s); }

    // W3C "standard" gamepad layout button bits
    static readonly Xbox360Button[] XMap = {
        Xbox360Button.A, Xbox360Button.B, Xbox360Button.X, Xbox360Button.Y,
        Xbox360Button.LeftShoulder, Xbox360Button.RightShoulder, null, null,
        Xbox360Button.Back, Xbox360Button.Start, Xbox360Button.LeftThumb, Xbox360Button.RightThumb,
        Xbox360Button.Up, Xbox360Button.Down, Xbox360Button.Left, Xbox360Button.Right, Xbox360Button.Guide,
    };

    public static void State(int slot, JsonNode c)
    {
        if (!pads.TryGetValue(slot, out var p)) return;
        uint b = (uint)(long)c["b"];
        short lx = (short)(int)c["lx"], ly = (short)(int)c["ly"], rx = (short)(int)c["rx"], ry = (short)(int)c["ry"];
        byte lt = (byte)(int)c["lt"], rt = (byte)(int)c["rt"];
        if (p is IXbox360Controller x)
        {
            for (int i = 0; i < XMap.Length; i++) if (XMap[i] != null) x.SetButtonState(XMap[i], (b & (1u << i)) != 0);
            x.SetAxisValue(Xbox360Axis.LeftThumbX, lx);
            x.SetAxisValue(Xbox360Axis.LeftThumbY, ClampNeg(ly));
            x.SetAxisValue(Xbox360Axis.RightThumbX, rx);
            x.SetAxisValue(Xbox360Axis.RightThumbY, ClampNeg(ry));
            x.SetSliderValue(Xbox360Slider.LeftTrigger, lt);
            x.SetSliderValue(Xbox360Slider.RightTrigger, rt);
            x.SubmitReport();
        }
        else if (p is IDualShock4Controller && ds4State.TryGetValue(slot, out var st))
        {
            // the browser reports up as negative, which is what DS4 wants (0 = top)
            st[0] = Ax(lx); st[1] = Ax(ly); st[2] = Ax(rx); st[3] = Ax(ry);
            int dpad = Dpad((b >> 12) & 1, (b >> 13) & 1, (b >> 14) & 1, (b >> 15) & 1);
            int w = dpad;
            if ((b & 4) != 0) w |= 1 << 4;  // square  (X)
            if ((b & 1) != 0) w |= 1 << 5;  // cross   (A)
            if ((b & 2) != 0) w |= 1 << 6;  // circle  (B)
            if ((b & 8) != 0) w |= 1 << 7;  // triangle(Y)
            if ((b & 16) != 0) w |= 1 << 8; if ((b & 32) != 0) w |= 1 << 9;
            if (lt > 0) w |= 1 << 10; if (rt > 0) w |= 1 << 11;
            if ((b & 256) != 0) w |= 1 << 12; if ((b & 512) != 0) w |= 1 << 13;
            if ((b & 1024) != 0) w |= 1 << 14; if ((b & 2048) != 0) w |= 1 << 15;
            st[4] = (byte)(w & 0xff); st[5] = (byte)(w >> 8);
            st[6] = (byte)(((b >> 16) & 1) | (((b >> 17) & 1) << 1));
            st[7] = lt; st[8] = rt;
            SubmitDs4(slot);
        }
    }

    static short ClampNeg(short v) => (short)Math.Clamp(-(int)v, -32768, 32767);
    static byte Ax(short v) => (byte)Math.Clamp((v + 32768) >> 8, 0, 255);

    static int Dpad(uint up, uint down, uint left, uint right)
    {
        if (up != 0 && right != 0) return 1; if (right != 0 && down != 0) return 3; if (down != 0 && left != 0) return 5; if (left != 0 && up != 0) return 7;
        if (up != 0) return 0; if (right != 0) return 2; if (down != 0) return 4; if (left != 0) return 6;
        return 8;
    }

    // gyro (deg/s scaled), accel, up to two touch points
    public static void Motion(int slot, JsonNode c)
    {
        if (!ds4State.TryGetValue(slot, out var st)) return;
        var g = c["g"]?.AsArray(); var a = c["a"]?.AsArray(); var t = c["t"]?.AsArray();
        if (g != null) for (int i = 0; i < 3; i++) BitConverter.TryWriteBytes(st.AsSpan(12 + i * 2), (short)(int)g[i]);
        if (a != null) for (int i = 0; i < 3; i++) BitConverter.TryWriteBytes(st.AsSpan(18 + i * 2), (short)(int)a[i]);
        st[29] = 0x1b; // "charging, full" so games don't nag about battery
        if (t != null)
        {
            st[32] = 1; st[33]++;
            for (int f = 0; f < 2; f++)
            {
                int o = 34 + f * 4;
                var p = f < t.Count ? t[f].AsArray() : null;
                bool on = p != null && (int)p[0] != 0;
                int x = on ? (int)p[1] : 0, y = on ? (int)p[2] : 0;
                st[o] = (byte)((on ? 0 : 0x80) | (f & 0x7f));
                st[o + 1] = (byte)(x & 0xff); st[o + 2] = (byte)(((x >> 8) & 0xf) | ((y & 0xf) << 4)); st[o + 3] = (byte)(y >> 4);
            }
        }
        SubmitDs4(slot);
    }

    static void SubmitDs4(int slot)
    {
        if (!pads.TryGetValue(slot, out var p) || p is not IDualShock4Controller d) return;
        var st = ds4State[slot];
        ds4Clock += 188; BitConverter.TryWriteBytes(st.AsSpan(9), ds4Clock);
        var m = d.GetType().GetMethod("SubmitRawReport", new[] { typeof(byte[]) });
        if (m != null) { m.Invoke(d, new object[] { st }); return; }
        // older client: buttons and sticks only
        d.SetAxisValue(DualShock4Axis.LeftThumbX, st[0]); d.SetAxisValue(DualShock4Axis.LeftThumbY, st[1]);
        d.SetAxisValue(DualShock4Axis.RightThumbX, st[2]); d.SetAxisValue(DualShock4Axis.RightThumbY, st[3]);
        d.SetSliderValue(DualShock4Slider.LeftTrigger, st[7]); d.SetSliderValue(DualShock4Slider.RightTrigger, st[8]);
        d.SubmitReport();
    }
}
