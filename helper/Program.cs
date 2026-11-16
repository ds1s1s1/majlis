// majlis-helper: the parts of hosting that need the Win32 side of Windows.
// Talks to the app over stdin (one JSON command per line) and stdout (framed binary).
//   frame = [type u8][length u32 LE][payload]
//   1 = JSON event, 2 = Opus game audio packet, 3 = cursor position
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Majlis;

static class Program
{
    static readonly Stream Out = Console.OpenStandardOutput();
    static readonly object OutLock = new();

    public static void Send(byte type, ReadOnlySpan<byte> payload)
    {
        lock (OutLock)
        {
            Span<byte> h = stackalloc byte[5];
            h[0] = type;
            BitConverter.TryWriteBytes(h[1..], payload.Length);
            try { Out.Write(h); Out.Write(payload); Out.Flush(); }
            catch { Environment.Exit(0); }
        }
    }

    public static void Event(string ev, object data = null)
    {
        var node = data == null ? new JsonObject() : JsonSerializer.SerializeToNode(data, data.GetType())!.AsObject();
        node["ev"] = ev;
        Send(1, Encoding.UTF8.GetBytes(node.ToJsonString()));
    }

    public static void Log(string msg) => Event("log", new { msg });

    [STAThread]
    static void Main()
    {
        Native.SetPriority();
        Native.GpuPriority(Environment.ProcessId);
        var stdin = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8);
        Event("ready", new { version = 1 });
        string line;
        while ((line = stdin.ReadLine()) != null)
        {
            if (line.Length == 0) continue;
            JsonNode cmd;
            try { cmd = JsonNode.Parse(line); } catch { continue; }
            try { Dispatch(cmd); }
            catch (Exception e) { Event("error", new { cmd = (string)cmd["cmd"], msg = e.Message }); }
        }
        Pads.RemoveAll();
        Input.ReleaseAll();
        Displays.RestoreAll();
    }

    static void Dispatch(JsonNode c)
    {
        string name = (string)c["cmd"];
        switch (name)
        {
            case "in": Input.Apply(c["e"].AsArray()); break;
            case "capture_rect": Input.SetRect((int)c["x"], (int)c["y"], (int)c["w"], (int)c["h"]); Cursor.SetRect((int)c["x"], (int)c["y"], (int)c["w"], (int)c["h"]); break;
            case "release_all": Input.ReleaseAll(); break;
            case "hello":
                Event("hello", new { vigem = Pads.Available, vigemError = Pads.Error, displays = Displays.List(), wgc = WindowCapture.Supported });
                break;
            case "displays": Event("displays", new { list = Displays.List() }); break;
            case "windows": Event("windows", new { list = Windows.List() }); break;
            case "icon": Event("icon", new { path = (string)c["path"], png = Windows.IconPng((string)c["path"]) }); break;
            case "mode": Event("mode", new { ok = Displays.SetMode((int)c["display"], (int)c["w"], (int)c["h"], (int?)c["hz"] ?? 0) }); break;
            case "mode_restore": Displays.RestoreAll(); break;
            case "pad_add": Pads.Add((int)c["slot"], (string)c["type"] ?? "x360"); break;
            case "pad": Pads.State((int)c["slot"], c); break;
            case "pad_motion": Pads.Motion((int)c["slot"], c); break;
            case "pad_del": Pads.Remove((int)c["slot"]); break;
            case "pads_clear": Pads.RemoveAll(); break;
            case "audio": if ((bool)c["on"]) AudioLoop.Start((int?)c["kbps"] ?? 128, (int?)c["keep"] ?? 30); else AudioLoop.Stop(); break;
            case "replay_audio": Event("replay_audio", new { path = (string)c["path"], ok = AudioLoop.SaveWav((string)c["path"], (int?)c["seconds"] ?? 30) }); break;
            case "cursor": if ((bool)c["on"]) Cursor.Start(); else Cursor.Stop(); break;
            case "wincap": WindowCapture.Start((long)c["hwnd"], (int?)c["fps"] ?? 60, (string)c["pipe"]); break;
            case "wincap_stop": WindowCapture.Stop(); break;
            case "focus": Windows.Focus((long)c["hwnd"]); break;
            case "gpu_prio": Event("gpu_prio", new { pid = (int)c["pid"], ok = Native.GpuPriority((int)c["pid"]) }); break;
            case "quit": Environment.Exit(0); break;
        }
    }
}
