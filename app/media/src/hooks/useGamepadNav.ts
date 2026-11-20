import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../settings/useSettingsStore';

interface GamepadNavOpts {
  active: boolean;
  theaterOpen: boolean;
  onBack: () => void;
  onCycleTab: (dir: -1 | 1) => void;
}

const FOCUS_SELECTOR = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]';

function isVisibleEl(el: HTMLElement): boolean {
  if (el.closest('[inert]') || el.closest('[aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 4 && r.height > 4 && r.bottom >= 0 && r.top <= window.innerHeight + 300;
}

function moveSpatialFocus(dx: number, dy: number, scopeSelector: string) {
  const scope = document.querySelector(scopeSelector) || document.body;
  const all = [...scope.querySelectorAll<HTMLElement>(FOCUS_SELECTOR)].filter(isVisibleEl);
  if (!all.length) return;

  const prev = document.querySelector<HTMLElement>('[data-gp-focus="1"]');
  const cur = prev && isVisibleEl(prev) ? prev : (document.activeElement as HTMLElement | null);
  let next: HTMLElement | null = null;

  if (!cur || !all.includes(cur)) {
    next = all[0];
  } else {
    const cr = cur.getBoundingClientRect();
    const cx = cr.left + cr.width / 2;
    const cy = cr.top + cr.height / 2;
    let bestScore = Infinity;

    for (const cand of all) {
      if (cand === cur) continue;
      const r = cand.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const vx = x - cx;
      const vy = y - cy;
      if (dx > 0 && vx <= 8) continue;
      if (dx < 0 && vx >= -8) continue;
      if (dy > 0 && vy <= 8) continue;
      if (dy < 0 && vy >= -8) continue;
      const primary = dx !== 0 ? Math.abs(vx) : Math.abs(vy);
      const cross = dx !== 0 ? Math.abs(vy) : Math.abs(vx);
      const dist = primary + cross * 2.4;
      if (dist < bestScore) {
        bestScore = dist;
        next = cand;
      }
    }
  }

  if (next) {
    document.querySelectorAll('[data-gp-focus]').forEach((n) => n.removeAttribute('data-gp-focus'));
    next.setAttribute('data-gp-focus', '1');
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
}

export function useGamepadNav({ active, theaterOpen, onBack, onCycleTab }: GamepadNavOpts) {
  const cbRef = useRef({ onBack, onCycleTab, theaterOpen, active });
  cbRef.current = { onBack, onCycleTab, theaterOpen, active };

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;

    let raf = 0;
    let running = false;
    const prevBtn = new Map<number, boolean>();
    let lastDir = '';
    let dirStart = 0;
    let lastStep = 0;

    const hasConnectedPad = () => {
      try {
        return [...navigator.getGamepads()].some((g) => g && g.connected);
      } catch {
        return false;
      }
    };

    const tick = (now: number) => {
      if (!running) return;
      const ctrl = useSettingsStore.getState().data.controls;
      const enabled = ctrl.controllerEnabled && (cbRef.current.active || cbRef.current.theaterOpen || ctrl.controllerBackground);

      const pads = [...(navigator.getGamepads?.() || [])].filter((g): g is Gamepad => !!(g && g.connected));
      if (!pads.length) {
        running = false;
        return;
      }

      if (enabled) {
        const gp = pads[0];
        const dead = Math.max(0.1, Math.min(0.6, (ctrl.stickDeadzonePct ?? 18) / 100));
        const axX = gp.axes[0] || 0;
        const axY = gp.axes[1] || 0;
        const up = gp.buttons[12]?.pressed || axY < -dead;
        const down = gp.buttons[13]?.pressed || axY > dead;
        const left = gp.buttons[14]?.pressed || axX < -dead;
        const right = gp.buttons[15]?.pressed || axX > dead;
        const dirKey = up ? 'u' : down ? 'd' : left ? 'l' : right ? 'r' : '';

        const stepReady = (() => {
          if (!dirKey) { lastDir = ''; return false; }
          if (dirKey !== lastDir) { lastDir = dirKey; dirStart = now; lastStep = now; return true; }
          if (now - dirStart >= (ctrl.initialDelayMs ?? 380) && now - lastStep >= (ctrl.repeatSpeedMs ?? 130)) {
            lastStep = now;
            return true;
          }
          return false;
        })();

        const just = (idx: number) => {
          const p = !!gp.buttons[idx]?.pressed;
          const was = prevBtn.get(idx) || false;
          prevBtn.set(idx, p);
          return p && !was;
        };

        const th = cbRef.current.theaterOpen;
        const thHasPopover = th && !!document.querySelector('.th-shell aside');

        if (stepReady) {
          if (th && !thHasPopover) {
            if (dirKey === 'l') window.majlis?.invoke?.('player:cmd', { cmd: 'seek', to: -10 }).catch(() => {});
            if (dirKey === 'r') window.majlis?.invoke?.('player:cmd', { cmd: 'seek', to: 10 }).catch(() => {});
            if (dirKey === 'u' || dirKey === 'd') {
              window.dispatchEvent(new KeyboardEvent('keydown', { key: dirKey === 'u' ? 'ArrowUp' : 'ArrowDown', bubbles: true }));
            }
          } else {
            const dx = dirKey === 'l' ? -1 : dirKey === 'r' ? 1 : 0;
            const dy = dirKey === 'u' ? -1 : dirKey === 'd' ? 1 : 0;
            moveSpatialFocus(dx, dy, th ? '.th-shell aside' : '.cin');
          }
        }

        if (just(0)) {
          if (th && !thHasPopover) {
            window.majlis?.invoke?.('player:cmd', { cmd: 'toggle' }).catch(() => {});
          } else {
            const target = document.querySelector<HTMLElement>('[data-gp-focus="1"]') || (document.activeElement as HTMLElement | null);
            target?.click?.();
          }
        }
        if (just(1)) {
          if (th) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          else cbRef.current.onBack();
        }
        if (just(2) && th) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true }));
        if (just(3)) {
          if (th) window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
          else window.dispatchEvent(new CustomEvent('majlis-cmd-palette'));
        }
        if (just(4)) {
          if (th) window.majlis?.invoke?.('player:cmd', { cmd: 'seek', to: -10 }).catch(() => {});
          else cbRef.current.onCycleTab(-1);
        }
        if (just(5)) {
          if (th) window.majlis?.invoke?.('player:cmd', { cmd: 'seek', to: 10 }).catch(() => {});
          else cbRef.current.onCycleTab(1);
        }
        if (just(6) && th) window.majlis?.invoke?.('player:cmd', { cmd: 'seek', to: -30 }).catch(() => {});
        if (just(7) && th) window.majlis?.invoke?.('player:cmd', { cmd: 'seek', to: 30 }).catch(() => {});
        if (just(9) && th) window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      }

      raf = requestAnimationFrame(tick);
    };

    const startLoop = () => {
      if (running || !hasConnectedPad()) return;
      running = true;
      raf = requestAnimationFrame(tick);
    };

    const onConnect = () => startLoop();
    const onDisconnect = () => {
      if (!hasConnectedPad()) {
        running = false;
        cancelAnimationFrame(raf);
        document.querySelectorAll('[data-gp-focus]').forEach((n) => n.removeAttribute('data-gp-focus'));
      }
    };

    window.addEventListener('gamepadconnected', onConnect);
    window.addEventListener('gamepaddisconnected', onDisconnect);
    startLoop();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('gamepadconnected', onConnect);
      window.removeEventListener('gamepaddisconnected', onDisconnect);
    };
  }, []);
}
