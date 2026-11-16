using Concentus;
using Concentus.Enums;
using NAudio.Wave;

namespace Majlis;

// Game audio: WASAPI loopback -> 48 kHz stereo -> Opus in 10 ms packets.
// Also keeps the last N seconds as PCM so instant replay can save sound with the clip.
static class AudioLoop
{
    static WasapiLoopbackCapture cap;
    static IOpusEncoder enc;
    static readonly List<float> pending = new();
    static short[] ring; static int ringPos; static bool ringFull;
    static double resamplePos;
    static uint seq;
    const int Rate = 48000, Frame = 480;

    public static void Start(int kbps, int keepSeconds)
    {
        Stop();
        enc = OpusCodecFactory.CreateEncoder(Rate, 2, OpusApplication.OPUS_APPLICATION_RESTRICTED_LOWDELAY);
        enc.Bitrate = kbps * 1000;
        enc.Complexity = 5;
        ring = new short[Rate * 2 * Math.Clamp(keepSeconds, 5, 120)]; ringPos = 0; ringFull = false;
        cap = new WasapiLoopbackCapture();
        var fmt = cap.WaveFormat;
        cap.DataAvailable += (s, e) => OnData(e.Buffer, e.BytesRecorded, fmt);
        cap.RecordingStopped += (s, e) => { };
        cap.StartRecording();
        Program.Event("audio", new { on = true, rate = fmt.SampleRate, ch = fmt.Channels });
    }

    public static void Stop()
    {
        try { cap?.StopRecording(); cap?.Dispose(); } catch { }
        cap = null; pending.Clear();
    }

    static void OnData(byte[] buf, int n, WaveFormat f)
    {
        int ch = f.Channels;
        int bps = f.BitsPerSample / 8;
        int frames = n / (bps * ch);
        bool isFloat = f.Encoding == WaveFormatEncoding.IeeeFloat || (f.Encoding == WaveFormatEncoding.Extensible && bps == 4);
        float Sample(int i, int c)
        {
            int o = (i * ch + c) * bps;
            if (isFloat) return BitConverter.ToSingle(buf, o);
            if (bps == 2) return BitConverter.ToInt16(buf, o) / 32768f;
            if (bps == 3) return ((buf[o] << 8 | buf[o + 1] << 16 | buf[o + 2] << 24) >> 8) / 8388608f;
            return BitConverter.ToInt32(buf, o) / 2147483648f;
        }
        double step = (double)f.SampleRate / Rate;
        lock (pending)
        {
            // linear resample to 48 kHz, downmix to stereo
            while (resamplePos < frames - 1)
            {
                int i = (int)resamplePos; double fr = resamplePos - i;
                float l = (float)(Sample(i, 0) * (1 - fr) + Sample(i + 1, 0) * fr);
                float r = ch > 1 ? (float)(Sample(i, 1) * (1 - fr) + Sample(i + 1, 1) * fr) : l;
                pending.Add(l); pending.Add(r);
                resamplePos += step;
            }
            resamplePos -= Math.Max(0, frames - 1);
            if (resamplePos < 0) resamplePos = 0;

            var span = System.Runtime.InteropServices.CollectionsMarshal.AsSpan(pending);
            int used = 0;
            Span<byte> outBuf = stackalloc byte[1500];
            while (span.Length - used >= Frame * 2)
            {
                var pcm = span.Slice(used, Frame * 2);
                for (int k = 0; k < pcm.Length; k++)
                {
                    ring[ringPos++] = (short)Math.Clamp(pcm[k] * 32767f, -32768f, 32767f);
                    if (ringPos == ring.Length) { ringPos = 0; ringFull = true; }
                }
                int len = enc.Encode(pcm, Frame, outBuf, outBuf.Length);
                if (len > 0)
                {
                    var pkt = new byte[len + 4];
                    BitConverter.TryWriteBytes(pkt, seq++);
                    outBuf[..len].CopyTo(pkt.AsSpan(4));
                    Program.Send(2, pkt);
                }
                used += Frame * 2;
            }
            pending.RemoveRange(0, used);
        }
    }

    public static bool SaveWav(string path, int seconds)
    {
        if (ring == null) return false;
        short[] copy;
        lock (pending)
        {
            int avail = ringFull ? ring.Length : ringPos;
            int want = Math.Min(avail, seconds * Rate * 2);
            copy = new short[want];
            int start = (ringPos - want + ring.Length) % ring.Length;
            for (int i = 0; i < want; i++) copy[i] = ring[(start + i) % ring.Length];
        }
        using var w = new WaveFileWriter(path, new WaveFormat(Rate, 16, 2));
        var bytes = new byte[copy.Length * 2];
        Buffer.BlockCopy(copy, 0, bytes, 0, bytes.Length);
        w.Write(bytes, 0, bytes.Length);
        return true;
    }
}
