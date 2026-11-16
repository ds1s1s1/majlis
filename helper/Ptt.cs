using System.Runtime.InteropServices;

namespace Majlis;

// Push-to-talk that works while a game has focus: poll the key's state globally.
// Mouse side buttons (VK 5/6) work too, which is what most people bind it to.
static class Ptt
{
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    static Thread thread;
    static volatile int key;

    public static void Watch(int vk)
    {
        key = vk;
        if (vk == 0 || thread != null) return;
        thread = new Thread(() =>
        {
            bool last = false;
            while (true)
            {
                int k = key;
                bool down = k != 0 && (GetAsyncKeyState(k) & 0x8000) != 0;
                if (down != last) { last = down; Program.Event("ptt", new { down }); }
                Thread.Sleep(10);
            }
        }) { IsBackground = true };
        thread.Start();
    }
}
