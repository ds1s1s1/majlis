'use strict';
// Dual-Monitor Cinema Dimmer: places click-through pure-black BrowserWindow overlays over all
// displays other than the active Theater display, tracks display hotplug/move events, and
// restores/destroys all overlays automatically when Cinema closes or opacity hits 0.

const HTML_BLACK = 'data:text/html;charset=utf-8,<style>html,body{margin:0;width:100%;height:100%;background:%23000;overflow:hidden}</style>';

class CinemaDimmer {
  constructor(deps = null) {
    this._deps = deps;
    this.overlays = new Map();
    this.opacity = 0;
    this.activeWin = null;
    this._boundRefresh = null;
  }

  _electron() {
    if (this._deps) return this._deps;
    return require('electron');
  }

  secondaryCount(activeWin) {
    try {
      const { screen } = this._electron();
      const all = screen.getAllDisplays() || [];
      if (all.length <= 1) return 0;
      if (!activeWin || activeWin.isDestroyed?.()) return all.length - 1;
      const cur = screen.getDisplayMatching(activeWin.getBounds());
      return all.filter((d) => d.id !== cur?.id).length;
    } catch {
      return 0;
    }
  }

  count() {
    return this.overlays.size;
  }

  _hookScreen() {
    if (this._boundRefresh) return;
    const { screen } = this._electron();
    this._boundRefresh = () => {
      if (this.opacity > 0 && this.activeWin && !this.activeWin.isDestroyed?.()) {
        this.apply({ activeWin: this.activeWin, opacity: this.opacity });
      } else {
        this.clear();
      }
    };
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on?.(ev, this._boundRefresh);
    }
  }

  _unhookScreen() {
    if (!this._boundRefresh) return;
    try {
      const { screen } = this._electron();
      for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
        screen.off?.(ev, this._boundRefresh);
      }
    } catch {}
    this._boundRefresh = null;
  }

  apply({ activeWin, opacity } = {}) {
    const pct = Math.max(0, Math.min(100, Math.round(Number(opacity) || 0)));
    if (pct <= 0 || !activeWin || activeWin.isDestroyed?.()) {
      this.clear();
      return { active: false, opacity: 0, displays: 0 };
    }
    const { screen, BrowserWindow } = this._electron();
    this.activeWin = activeWin;
    this.opacity = pct;
    const activeDisplay = screen.getDisplayMatching(activeWin.getBounds());
    const others = (screen.getAllDisplays() || []).filter((d) => d.id !== activeDisplay?.id);
    const keepIds = new Set(others.map((d) => d.id));

    for (const [id, bw] of this.overlays.entries()) {
      if (!keepIds.has(id) || bw.isDestroyed?.()) {
        try { if (!bw.isDestroyed?.()) bw.destroy(); } catch {}
        this.overlays.delete(id);
      }
    }

    const alpha = Math.max(0.05, Math.min(1, pct / 100));
    for (const d of others) {
      let bw = this.overlays.get(d.id);
      if (!bw || bw.isDestroyed?.()) {
        bw = new BrowserWindow({
          x: d.bounds.x,
          y: d.bounds.y,
          width: d.bounds.width,
          height: d.bounds.height,
          frame: false,
          transparent: false,
          backgroundColor: '#000000',
          skipTaskbar: true,
          focusable: false,
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          hasShadow: false,
          alwaysOnTop: true,
          show: false,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        bw.setIgnoreMouseEvents?.(true, { forward: true });
        bw.loadURL?.(HTML_BLACK);
        this.overlays.set(d.id, bw);
      } else {
        bw.setBounds?.(d.bounds);
      }
      bw.setOpacity?.(alpha);
      bw.showInactive?.();
    }

    if (others.length) this._hookScreen();
    else this._unhookScreen();

    return { active: this.overlays.size > 0, opacity: pct, displays: this.overlays.size };
  }

  clear() {
    this._unhookScreen();
    for (const bw of this.overlays.values()) {
      try { if (!bw.isDestroyed?.()) bw.destroy(); } catch {}
    }
    this.overlays.clear();
    this.opacity = 0;
    this.activeWin = null;
  }
}

module.exports = { CinemaDimmer };
