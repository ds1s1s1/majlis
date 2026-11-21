import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';

export interface Html5Cmd {
  op: 'pause' | 'seek' | 'speed' | 'volume' | 'mute' | 'aid' | 'sid';
  on?: boolean;
  to?: number;
  abs?: boolean;
  v?: number;
  id?: string | number;
}

interface Html5StageProps {
  url: string;
  startPos?: number;
  isHls?: boolean;
  cmdSeq: { seq: number; cmd: Html5Cmd } | null;
  onFirstFrame: () => void;
}

const sendHtml5Event = (payload: Record<string, unknown>) => {
  window.majlis?.invoke?.('theater:html5-event', payload)?.catch?.(() => {});
};

export function Html5Stage({ url, startPos = 0, isHls = false, cmdSeq, onFirstFrame }: Html5StageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const firstFrameRef = useRef(false);
  const onFirstRef = useRef(onFirstFrame);
  onFirstRef.current = onFirstFrame;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;
    firstFrameRef.current = false;

    let hls: Hls | null = null;
    let mpeg: mpegts.Player | null = null;
    let destroyed = false;
    let lastEmitAt = 0;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let stallRetried = false;

    const clearStall = () => {
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    };
    const armStall = () => {
      clearStall();
      stallTimer = setTimeout(() => {
        if (destroyed || video.paused) return;
        if (hls && !stallRetried) {
          stallRetried = true;
          try { hls.startLoad(); } catch {}
          armStall();
          return;
        }
        sendHtml5Event({ error: 'Stream stalled for too long' });
      }, 15000);
    };

    const emitSnapshot = (force = false) => {
      const now = Date.now();
      if (!force && now - lastEmitAt < 180) return;
      lastEmitAt = now;
      sendHtml5Event({
        props: {
          'time-pos': Number.isFinite(video.currentTime) ? video.currentTime : 0,
          duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0,
          pause: video.paused,
          'paused-for-cache': false,
          volume: Math.round((video.volume ?? 1) * 100),
          mute: !!video.muted,
          speed: video.playbackRate || 1,
        },
      });
    };

    const markFirstFrame = () => {
      if (!firstFrameRef.current) {
        firstFrameRef.current = true;
        onFirstRef.current?.();
      }
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        sendHtml5Event({
          name: 'video-params',
          value: { w: video.videoWidth, h: video.videoHeight, dw: video.videoWidth, dh: video.videoHeight },
        });
      }
      emitSnapshot(true);
    };

    const applyStartPos = () => {
      if (startPos > 1 && Number.isFinite(startPos)) {
        try { video.currentTime = startPos; } catch {}
      }
      video.play().catch(() => {});
    };

    const onTimeUpdate = () => { clearStall(); stallRetried = false; emitSnapshot(false); };
    const onPlaying = () => { clearStall(); stallRetried = false; markFirstFrame(); sendHtml5Event({ props: { pause: false, 'paused-for-cache': false } }); };
    const onPause = () => { clearStall(); sendHtml5Event({ name: 'pause', value: true }); };
    const onWaiting = () => { armStall(); sendHtml5Event({ name: 'paused-for-cache', value: true }); };
    const onRate = () => sendHtml5Event({ name: 'speed', value: video.playbackRate || 1 });
    const onEnded = () => sendHtml5Event({ eof: true });
    const onError = () => {
      if (destroyed) return;
      sendHtml5Event({ error: video.error?.message || 'HTML5 playback failed' });
    };

    video.addEventListener('loadedmetadata', applyStartPos);
    video.addEventListener('loadeddata', markFirstFrame);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('ratechange', onRate);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    const wantsHls = (isHls || /(\.m3u8(\?|$)|\/hlsv2\/)/i.test(url)) && Hls.isSupported();
    const wantsMpegts = !wantsHls && /\.(ts|m2ts|flv)(\?|$)/i.test(url) && mpegts.isSupported();

    if (wantsHls) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        startPosition: startPos > 1 ? startPos : -1,
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!destroyed) applyStartPos();
      });
      let mediaRecovered = false;
      let netRetries = 0;
      hls.on(Hls.Events.ERROR, (_ev, data) => {
        if (destroyed || !data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && netRetries < 2) {
          netRetries++;
          hls?.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
          mediaRecovered = true;
          hls?.recoverMediaError();
          return;
        }
        sendHtml5Event({ error: `HLS error: ${data.details || data.type}` });
      });
    } else if (wantsMpegts) {
      const kind = /\.flv(\?|$)/i.test(url) ? 'flv' : 'mpegts';
      mpeg = mpegts.createPlayer({ type: kind, url, isLive: false });
      mpeg.attachMediaElement(video);
      mpeg.load();
      mpeg.on(mpegts.Events.ERROR, (errType, errDetail) => {
        if (!destroyed) sendHtml5Event({ error: `Stream error: ${String(errDetail || errType || 'failed')}` });
      });
    } else {
      video.src = url;
    }

    return () => {
      destroyed = true;
      clearStall();
      video.removeEventListener('loadedmetadata', applyStartPos);
      video.removeEventListener('loadeddata', markFirstFrame);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('ratechange', onRate);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      try { hls?.destroy(); } catch {}
      try {
        if (mpeg) {
          mpeg.unload();
          mpeg.detachMediaElement();
          mpeg.destroy();
        }
      } catch {}
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {}
    };
  }, [url, startPos, isHls]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !cmdSeq) return;
    const c = cmdSeq.cmd;
    if (c.op === 'pause') {
      if (c.on) video.pause();
      else video.play().catch(() => {});
    } else if (c.op === 'seek') {
      const cur = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const tgt = c.abs ? (Number(c.to) || 0) : (cur + (Number(c.to) || 0));
      try { video.currentTime = Math.max(0, tgt); } catch {}
    } else if (c.op === 'speed') {
      video.playbackRate = Math.min(4, Math.max(0.25, Number(c.v) || 1));
    } else if (c.op === 'volume') {
      const pct = Math.min(100, Math.max(0, Number(c.v) || 0));
      video.volume = pct / 100;
      if (pct > 0 && video.muted) video.muted = false;
    } else if (c.op === 'mute') {
      video.muted = !!c.on;
    } else if (c.op === 'sid' && video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = c.id === 'no' ? 'disabled' : (String(i + 1) === String(c.id) ? 'showing' : 'disabled');
      }
    }
  }, [cmdSeq]);

  return (
    <div className="pointer-events-none absolute inset-0 z-0 bg-black">
      <video ref={videoRef} className="h-full w-full object-contain" playsInline autoPlay />
    </div>
  );
}
