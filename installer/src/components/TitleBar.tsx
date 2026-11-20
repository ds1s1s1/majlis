import { Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function TitleBar({ title }: { title: string }) {
  const minimize = () => {
    try { getCurrentWindow().minimize(); } catch {}
  };
  const close = () => {
    try { getCurrentWindow().close(); } catch {}
  };

  return (
    <header
      dir="ltr"
      data-tauri-drag-region
      className="flex h-[38px] w-full shrink-0 items-center justify-between border-b border-[#26231F]/60 bg-[#12100E] px-4"
    >
      <span data-tauri-drag-region className="font-mono-tech text-[11px] font-medium tracking-wider text-[#7D776D]">
        {title}
      </span>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={minimize}
          aria-label="Minimize"
          className="grid size-7 place-items-center rounded-md text-[#B8B2A7] transition hover:bg-[#1F1C18] hover:text-[#F2EFE9]"
        >
          <Minus size={14} />
        </button>
        <span
          aria-hidden
          className="grid size-7 place-items-center rounded-md text-[#544F47]/45 cursor-default"
        >
          <Square size={11} />
        </span>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="grid size-7 place-items-center rounded-md text-[#B8B2A7] transition hover:bg-[#D9534F]/25 hover:text-red-300"
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
