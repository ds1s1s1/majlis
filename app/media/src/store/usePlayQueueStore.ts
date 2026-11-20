import { create } from 'zustand';
import { cin, type Type } from '../api';

export interface PlayQueueItem {
  key: string;
  id: string;
  type: Type;
  name: string;
  poster: string | null;
  videoId?: string;
  epLabel?: string;
  directUrl?: string;
  addedBy?: string;
  addedByAccent?: string;
  addedAt: number;
}

const STORAGE_KEY = 'majlis:play-queue-v1';
const MAX_QUEUE = 100;

function readStoredQueue(): PlayQueueItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.key === 'string' && typeof x.id === 'string' && typeof x.name === 'string')
      .slice(0, MAX_QUEUE);
  } catch {
    return [];
  }
}

function saveAndSync(items: PlayQueueItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
  cin('queue-sync', { items }).catch(() => {});
}

interface PlayQueueStore {
  items: PlayQueueItem[];
  open: boolean;
  setOpen: (open: boolean) => void;
  enqueue: (entry: { id: string; type: Type; name: string; poster?: string | null; videoId?: string; epLabel?: string; directUrl?: string; addedBy?: string; addedByAccent?: string }) => boolean;
  remove: (key: string) => void;
  move: (fromIdx: number, toIdx: number) => void;
  clear: () => void;
  shift: () => PlayQueueItem | null;
  setItemsFromMain: (items: PlayQueueItem[]) => void;
}

const initialItems = readStoredQueue();

export const usePlayQueueStore = create<PlayQueueStore>((set, get) => ({
  items: initialItems,
  open: false,
  setOpen: (open) => set({ open }),
  enqueue: (entry) => {
    const key = entry.videoId || entry.id;
    const prev = get().items;
    if (prev.some((x) => x.key === key)) return false;
    const nextItem: PlayQueueItem = {
      key,
      id: entry.id,
      type: entry.type,
      name: entry.name,
      poster: entry.poster || null,
      videoId: entry.videoId,
      epLabel: entry.epLabel,
      directUrl: entry.directUrl,
      addedBy: entry.addedBy,
      addedByAccent: entry.addedByAccent,
      addedAt: Date.now(),
    };
    const next = [...prev, nextItem].slice(0, MAX_QUEUE);
    set({ items: next });
    saveAndSync(next);
    return true;
  },
  remove: (key) => {
    const next = get().items.filter((x) => x.key !== key);
    set({ items: next });
    saveAndSync(next);
  },
  move: (fromIdx, toIdx) => {
    const prev = [...get().items];
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= prev.length || toIdx >= prev.length || fromIdx === toIdx) return;
    const [picked] = prev.splice(fromIdx, 1);
    prev.splice(toIdx, 0, picked);
    set({ items: prev });
    saveAndSync(prev);
  },
  clear: () => {
    set({ items: [] });
    saveAndSync([]);
  },
  shift: () => {
    const prev = get().items;
    if (!prev.length) return null;
    const [head, ...rest] = prev;
    set({ items: rest });
    saveAndSync(rest);
    return head;
  },
  setItemsFromMain: (items) => {
    const clean = Array.isArray(items) ? items.slice(0, MAX_QUEUE) : [];
    set({ items: clean });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch {}
  },
}));

// Sync persisted initial queue to main process and subscribe to main EOF queue updates.
if (typeof window !== 'undefined' && window.majlis) {
  if (initialItems.length) {
    cin('queue-sync', { items: initialItems }).catch(() => {});
  }
  window.majlis.on?.((m: { type?: string; items?: PlayQueueItem[] }) => {
    if (m?.type === 'cin:queue-updated' && Array.isArray(m.items)) {
      usePlayQueueStore.getState().setItemsFromMain(m.items);
    }
  });
}
