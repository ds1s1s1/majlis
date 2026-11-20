import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { App } from './App';
import { TitleBar } from './components/TitleBar';
import { INSTALLER_CONFIG } from './config/installerConfig';
import './index.css';

function writeSetupErrorLog(message: string) {
  try {
    void invoke('log_setup_error', { message }).catch(() => {});
  } catch {}
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (ev) => {
    const detail = ev.error instanceof Error ? ev.error.stack || ev.error.message : ev.message;
    writeSetupErrorLog(`window.onerror: ${detail || 'Unknown error'}`);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason instanceof Error ? ev.reason.stack || ev.reason.message : String(ev.reason);
    writeSetupErrorLog(`unhandledrejection: ${reason}`);
  });
}

class SetupErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    writeSetupErrorLog(`React ErrorBoundary: ${error.stack || error.message}\n${info.componentStack || ''}`);
  }

  render() {
    if (this.state.error) {
      return (
        <div dir="ltr" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-[#12100E] p-8 text-center text-[#F2EFE9]">
          <div className="max-w-[580px] rounded-xl border border-red-400/35 bg-[#181613] p-6 space-y-3">
            <h1 className="text-base font-bold text-red-300">Majlis Setup encountered an unexpected error</h1>
            <p className="font-mono-tech text-xs text-[#C4BEB4] break-all">{this.state.error.message}</p>
            <p className="font-mono-tech text-[11px] text-[#7D776D]">
              Details were written to %TEMP%\majlis-setup-error.log
            </p>
            <button
              type="button"
              onClick={() => { try { void getCurrentWindow().close(); } catch {} }}
              className="rounded-lg bg-[#E5A93C] px-5 py-2 text-xs font-bold text-[#12100E] hover:bg-[#F0B952]"
            >
              Close
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="flex h-[640px] w-[940px] flex-col overflow-hidden rounded-lg border border-[#26221C] bg-[#12100E] text-[#F2EFE9]">
      <TitleBar title={`Majlis Setup v${INSTALLER_CONFIG.version}`} />
      <SetupErrorBoundary>
        <App />
      </SetupErrorBoundary>
    </div>
  </StrictMode>,
);
