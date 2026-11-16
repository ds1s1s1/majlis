'use strict';
// Instant replay: while hosting, a second light encoder writes 1-second segments into a ring
// on disk. "Save" stitches the last N seconds together with the game audio into an mp4.
// NVENC handles both encoders at once without touching the stream's quality.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

class Replay {
  constructor({ ffmpeg, helper, store, encoders }) {
    this.ffmpeg = ffmpeg; this.helper = helper; this.store = store; this.encoders = encoders;
    this.dir = path.join(os.tmpdir(), `majlis-replay-${process.pid}`);
    this.p = null;
  }

  get running() { return !!this.p; }

  start(display = 0) {
    if (this.p) return;
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    const enc = this.encoders.find((e) => e.name === 'hevc_nvenc') || this.encoders.find((e) => e.name === 'h264_nvenc') || this.encoders.find((e) => e.codec === 'h264');
    if (!enc) return;
    const secs = this.store.get('replaySeconds') || 30;
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin',
      '-f', 'lavfi', '-i', `ddagrab=output_idx=${display}:framerate=60:draw_mouse=1`];
    if (enc.fam === 'sw') args.push('-vf', 'hwdownload,format=bgra,format=yuv420p');
    args.push('-c:v', enc.name);
    if (enc.fam === 'nvenc') args.push('-preset', 'p4', '-rc', 'vbr', '-cq', '24', '-b:v', '20M', '-maxrate', '30M', '-g', '60', '-forced-idr', '1');
    else args.push('-b:v', '15M', '-g', '60');
    args.push('-f', 'segment', '-segment_time', '1', '-segment_wrap', String(secs + 6), '-reset_timestamps', '1', path.join(this.dir, 'seg%03d.ts'));
    this.p = spawn(this.ffmpeg, args, { windowsHide: true, stdio: 'ignore' });
    this.p.on('exit', () => { this.p = null; });
  }

  stop() { try { this.p?.kill(); } catch {} this.p = null; }

  async save() {
    if (!this.p) return { ok: false, reason: 'off' };
    const secs = this.store.get('replaySeconds') || 30;
    const segs = fs.readdirSync(this.dir).filter((f) => f.endsWith('.ts')).map((f) => ({ f, t: fs.statSync(path.join(this.dir, f)).mtimeMs })).sort((a, b) => a.t - b.t);
    const use = segs.slice(0, -1).slice(-secs); // the newest one is still being written
    if (!use.length) return { ok: false, reason: 'empty' };
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'majlis-clip-'));
    const list = path.join(work, 'list.txt');
    const copies = use.map(({ f }, i) => { const dst = path.join(work, `${i}.ts`); fs.copyFileSync(path.join(this.dir, f), dst); return dst; });
    fs.writeFileSync(list, copies.map((c) => `file '${c.replace(/\\/g, '/')}'`).join('\n'));
    const wav = path.join(work, 'audio.wav');
    const a = await this.helper.request({ cmd: 'replay_audio', path: wav, seconds: use.length }, 'replay_audio', 4000);
    const outDir = path.join(os.homedir(), 'Videos', 'Majlis');
    fs.mkdirSync(outDir, { recursive: true });
    const d = new Date();
    const out = path.join(outDir, `Majlis ${d.toISOString().slice(0, 10)} ${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}-${String(d.getSeconds()).padStart(2, '0')}.mp4`);
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
    if (a?.ok && fs.existsSync(wav)) args.push('-i', wav, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest');
    args.push('-c:v', 'copy', '-movflags', '+faststart', '-y', out);
    const ok = await new Promise((res) => execFile(this.ffmpeg, args, { windowsHide: true, timeout: 60000 }, (e) => res(!e)));
    fs.rmSync(work, { recursive: true, force: true });
    return ok ? { ok: true, path: out } : { ok: false, reason: 'mux' };
  }
}

module.exports = { Replay };
