import { useEffect, useRef } from 'react';
import { ackRenderedFrame, subscribeFrames, type ThFrame } from './frameBus';

export interface AmbientSample {
  top: string;
  bottom: string;
  left: string;
  right: string;
}

const VS_SRC = `#version 300 es
out vec2 vUv;
void main() {
  vec2 pos = vec2(float((gl_VertexID & 1) * 4) - 1.0, float((gl_VertexID & 2) * 2) - 1.0);
  vUv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const FS_SRC = `#version 300 es
precision highp float;
in vec2 vUv;
uniform int uMode;
uniform sampler2D uY;
uniform sampler2D uUV;
uniform sampler2D uBgra;
uniform float uWarm;
uniform float uSplit;
uniform vec2 uTexel;
out vec4 fragColor;

vec3 sampleRgb(vec2 uv) {
  if (uMode == 1) return texture(uBgra, uv).bgr;
  if (uMode == 2) return texture(uBgra, uv).rgb;
  float y = texture(uY, uv).r;
  vec2 uvC = texture(uUV, uv).rg - vec2(0.5);
  return clamp(vec3(y + 1.5748 * uvC.y, y - 0.187324 * uvC.x - 0.468124 * uvC.y, y + 1.8556 * uvC.x), 0.0, 1.0);
}

void main() {
  vec3 raw = sampleRgb(vUv);
  if (uSplit > 0.0) {
    float edge = max(uTexel.x * 1.5, 0.0014);
    if (abs(vUv.x - uSplit) < edge) {
      fragColor = vec4(0.886, 0.643, 0.227, 1.0);
      return;
    }
    if (vUv.x < uSplit) {
      fragColor = vec4(raw, 1.0);
      return;
    }
    vec3 blur = (
      sampleRgb(vUv + vec2(uTexel.x, 0.0)) +
      sampleRgb(vUv - vec2(uTexel.x, 0.0)) +
      sampleRgb(vUv + vec2(0.0, uTexel.y)) +
      sampleRgb(vUv - vec2(0.0, uTexel.y))
    ) * 0.25;
    vec3 sharp = clamp(raw + (raw - blur) * 0.32, 0.0, 1.0);
    if (uWarm > 0.001) {
      sharp *= vec3(mix(1.0, 1.04, uWarm), mix(1.0, 0.92, uWarm), mix(1.0, 0.72, uWarm));
    }
    fragColor = vec4(clamp(sharp, 0.0, 1.0), 1.0);
    return;
  }
  if (uWarm > 0.001) {
    raw *= vec3(mix(1.0, 1.04, uWarm), mix(1.0, 0.92, uWarm), mix(1.0, 0.72, uWarm));
  }
  fragColor = vec4(clamp(raw, 0.0, 1.0), 1.0);
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function sampleEdgeRgb(f: ThFrame, x0: number, x1: number, y0: number, y1: number): string {
  const { w, h, fmt, data } = f;
  const cols = 4;
  const rows = 2;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let cnt = 0;
  const yLen = w * h;
  const uvW = w >> 1;
  for (let ri = 0; ri < rows; ri++) {
    const py = Math.min(h - 1, Math.max(0, Math.round(y0 + ((y1 - y0) * (ri + 0.5)) / rows)));
    for (let ci = 0; ci < cols; ci++) {
      const px = Math.min(w - 1, Math.max(0, Math.round(x0 + ((x1 - x0) * (ci + 0.5)) / cols)));
      if (fmt === 'bgra') {
        const idx = (py * w + px) * 4;
        sb += data[idx];
        sg += data[idx + 1];
        sr += data[idx + 2];
      } else if (fmt === 'rgba') {
        const idx = (py * w + px) * 4;
        sr += data[idx];
        sg += data[idx + 1];
        sb += data[idx + 2];
      } else {
        const yv = data[py * w + px] / 255;
        const uvIdx = yLen + ((py >> 1) * uvW + (px >> 1)) * 2;
        const u = (data[uvIdx] - 128) / 255;
        const v = (data[uvIdx + 1] - 128) / 255;
        sr += Math.min(255, Math.max(0, Math.round((yv + 1.5748 * v) * 255)));
        sg += Math.min(255, Math.max(0, Math.round((yv - 0.1873 * u - 0.4681 * v) * 255)));
        sb += Math.min(255, Math.max(0, Math.round((yv + 1.8556 * u) * 255)));
      }
      cnt++;
    }
  }
  if (!cnt) return 'rgb(0,0,0)';
  return `rgb(${Math.round(sr / cnt)}, ${Math.round(sg / cnt)}, ${Math.round(sb / cnt)})`;
}

function sampleAmbientEdges(f: ThFrame): AmbientSample {
  const { w, h } = f;
  const mx = Math.round(w * 0.12);
  const my = Math.round(h * 0.12);
  return {
    top: sampleEdgeRgb(f, mx, w - mx, 4, my),
    bottom: sampleEdgeRgb(f, mx, w - mx, h - my, h - 4),
    left: sampleEdgeRgb(f, 4, mx, my, h - my),
    right: sampleEdgeRgb(f, w - mx, w - 4, my, h - my),
  };
}

export function Nv12Canvas({
  onFirstFrame,
  ambientEnabled = false,
  onAmbientColor,
  warmTint = 0,
  compareActive = false,
  compareSplit = 0.5,
}: {
  onFirstFrame?: () => void;
  ambientEnabled?: boolean;
  onAmbientColor?: (sample: AmbientSample | null) => void;
  warmTint?: number;
  compareActive?: boolean;
  compareSplit?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const firstRef = useRef(onFirstFrame);
  firstRef.current = onFirstFrame;
  const ambientRef = useRef(ambientEnabled);
  ambientRef.current = ambientEnabled;
  const ambientCbRef = useRef(onAmbientColor);
  ambientCbRef.current = onAmbientColor;
  const warmRef = useRef(warmTint);
  warmRef.current = Math.max(0, Math.min(1, warmTint / 100));
  const splitRef = useRef(compareActive ? Math.max(0.05, Math.min(0.95, compareSplit)) : -1);
  splitRef.current = compareActive ? Math.max(0.05, Math.min(0.95, compareSplit)) : -1;
  const redrawRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!ambientEnabled) onAmbientColor?.(null);
  }, [ambientEnabled, onAmbientColor]);

  useEffect(() => {
    redrawRef.current?.();
  }, [warmTint, compareActive, compareSplit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
      desynchronized: false,
    });
    if (!gl) return;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VS_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_SRC);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      if (prog) gl.deleteProgram(prog);
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.deleteProgram(prog);
      return;
    }

    const vao = gl.createVertexArray();
    const mkTex = (unit: number) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const texY = mkTex(0);
    const texUv = mkTex(1);
    const texBgra = mkTex(2);
    const uMode = gl.getUniformLocation(prog, 'uMode');
    const uY = gl.getUniformLocation(prog, 'uY');
    const uUV = gl.getUniformLocation(prog, 'uUV');
    const uBgra = gl.getUniformLocation(prog, 'uBgra');
    const uWarm = gl.getUniformLocation(prog, 'uWarm');
    const uSplit = gl.getUniformLocation(prog, 'uSplit');
    const uTexel = gl.getUniformLocation(prog, 'uTexel');

    gl.useProgram(prog);
    gl.uniform1i(uY, 0);
    gl.uniform1i(uUV, 1);
    gl.uniform1i(uBgra, 2);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    let allocW = 0;
    let allocH = 0;
    let allocFmt: 'nv12' | 'bgra' | 'rgba' | '' = '';
    let sentFirst = false;
    let pendingFrame: ThFrame | null = null;
    let rafId = 0;
    let lastAmbientAt = 0;

    const applyPostUniforms = (w: number, h: number) => {
      gl.uniform1f(uWarm, warmRef.current);
      gl.uniform1f(uSplit, splitRef.current);
      gl.uniform2f(uTexel, 1 / Math.max(1, w), 1 / Math.max(1, h));
    };

    const drawLastTexture = () => {
      if (allocW <= 0 || allocH <= 0) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      applyPostUniforms(allocW, allocH);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    redrawRef.current = drawLastTexture;

    const clearBlack = () => {
      if (pendingFrame) ackRenderedFrame();
      pendingFrame = null;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      allocW = 0;
      allocH = 0;
      allocFmt = '';
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      sentFirst = false;
      ambientCbRef.current?.(null);
    };

    const drawFrameNow = (f: ThFrame) => {
      const { w, h, fmt, data } = f;
      if (w < 2 || h < 2) {
        ackRenderedFrame();
        return;
      }
      const resized = w !== allocW || h !== allocH || fmt !== allocFmt;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      gl.viewport(0, 0, w, h);

      if (fmt === 'bgra' || fmt === 'rgba') {
        const need = w * h * 4;
        if (data.byteLength < need) {
          ackRenderedFrame();
          return;
        }
        const plane = data.byteLength === need ? data : data.subarray(0, need);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, texBgra);
        if (resized) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, plane);
        else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, plane);
        gl.uniform1i(uMode, fmt === 'rgba' ? 2 : 1);
      } else {
        const uvW = w >> 1;
        const uvH = h >> 1;
        const yBytes = w * h;
        const uvBytes = uvW * uvH * 2;
        if (uvW < 1 || uvH < 1 || data.byteLength < yBytes + uvBytes) {
          ackRenderedFrame();
          return;
        }
        const yPlane = data.subarray(0, yBytes);
        const uvPlane = data.subarray(yBytes, yBytes + uvBytes);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texY);
        if (resized) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, yPlane);
        else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.UNSIGNED_BYTE, yPlane);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, texUv);
        if (resized) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, uvW, uvH, 0, gl.RG, gl.UNSIGNED_BYTE, uvPlane);
        else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, uvW, uvH, gl.RG, gl.UNSIGNED_BYTE, uvPlane);

        gl.uniform1i(uMode, 0);
      }
      allocW = w;
      allocH = h;
      allocFmt = fmt;

      applyPostUniforms(w, h);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      ackRenderedFrame();

      if (ambientRef.current && ambientCbRef.current) {
        const now = performance.now();
        if (now - lastAmbientAt >= 160) {
          lastAmbientAt = now;
          ambientCbRef.current(sampleAmbientEdges(f));
        }
      }
      if (!sentFirst) {
        sentFirst = true;
        firstRef.current?.();
      }
    };

    const scheduleFrame = (f: ThFrame | null) => {
      if (!f) {
        clearBlack();
        return;
      }
      if (pendingFrame) ackRenderedFrame();
      pendingFrame = f;
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          const next = pendingFrame;
          pendingFrame = null;
          if (next) drawFrameNow(next);
        });
      }
    };

    // Immediate zero-upload GPU redraw on window drag/resize/maximize so WebGL swapchain never flashes black
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(drawLastTexture)
      : null;
    ro?.observe(canvas);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      allocW = 0;
      allocH = 0;
      allocFmt = '';
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    clearBlack();
    const unsub = subscribeFrames(scheduleFrame);

    return () => {
      redrawRef.current = null;
      unsub();
      ro?.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      clearBlack();
      gl.deleteTexture(texY);
      gl.deleteTexture(texUv);
      gl.deleteTexture(texBgra);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
    };
  }, []);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />;
}
