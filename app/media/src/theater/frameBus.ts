export interface ThFrame {
  w: number;
  h: number;
  fmt: 'nv12' | 'bgra' | 'rgba';
  data: Uint8Array;
}

type FrameListener = (frame: ThFrame | null) => void;

const listeners = new Set<FrameListener>();
let latestFrame: ThFrame | null = null;
let ackFn: (() => void) | null = null;

function dispatch(rawMsg: unknown) {
  const msg = rawMsg as { t?: string; w?: number; h?: number; fmt?: string; data?: ArrayBufferView | ArrayBuffer | number[] } | null;
  if (!msg || msg.t === 'thv-clear') {
    latestFrame = null;
    for (const fn of listeners) fn(null);
    return;
  }
  if (msg.t !== 'thv' || !msg.w || !msg.h || !msg.data) return;
  const raw = msg.data;
  const data = raw instanceof Uint8Array
    ? raw
    : ArrayBuffer.isView(raw)
      ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
      : new Uint8Array(raw as ArrayBuffer);
  const fmt: ThFrame['fmt'] = msg.fmt === 'bgra' ? 'bgra' : msg.fmt === 'rgba' ? 'rgba' : 'nv12';
  latestFrame = { w: msg.w, h: msg.h, fmt, data };
  for (const fn of listeners) fn(latestFrame);
}

declare global {
  interface Window {
    __majlisThFrame?: (msg: unknown) => void;
    __majlisThSetAck?: (fn: (() => void) | null) => void;
    __majlisThAck?: () => void;
  }
}

export function setAckHandler(fn: (() => void) | null) {
  ackFn = fn;
}

export function ackRenderedFrame() {
  try {
    if (ackFn) ackFn();
    else window.__majlisThAck?.();
  } catch {}
}

if (typeof window !== 'undefined') {
  window.__majlisThFrame = dispatch;
  window.__majlisThSetAck = setAckHandler;
}

export function subscribeFrames(fn: FrameListener): () => void {
  listeners.add(fn);
  if (latestFrame) fn(latestFrame);
  return () => {
    listeners.delete(fn);
  };
}

export function clearFrames() {
  dispatch({ t: 'thv-clear' });
}
