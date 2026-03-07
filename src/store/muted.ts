import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureScopeDir, getScopeDir } from "./config.js";

export interface SnoozeEntry {
  id: string;
  until: string;
  created: string;
}

export interface MuteEntry {
  id: string;
  created: string;
}

export interface MutedStore {
  snoozed: SnoozeEntry[];
  muted: MuteEntry[];
}

const MUTED_PATH = join(getScopeDir(), "muted.json");

function emptyStore(): MutedStore {
  return { snoozed: [], muted: [] };
}

function normalizeStore(raw: unknown): MutedStore {
  if (!raw || typeof raw !== "object") {
    return emptyStore();
  }

  const maybeStore = raw as Partial<MutedStore>;
  return {
    snoozed: Array.isArray(maybeStore.snoozed) ? maybeStore.snoozed : [],
    muted: Array.isArray(maybeStore.muted) ? maybeStore.muted : [],
  };
}

function cleanExpiredSnoozes(store: MutedStore): MutedStore {
  const now = Date.now();
  return {
    muted: store.muted,
    snoozed: store.snoozed.filter((entry) => {
      const untilMs = new Date(entry.until).getTime();
      return Number.isFinite(untilMs) && untilMs > now;
    }),
  };
}

export function loadMuted(): MutedStore {
  ensureScopeDir();
  if (!existsSync(MUTED_PATH)) {
    return emptyStore();
  }

  try {
    const raw = JSON.parse(readFileSync(MUTED_PATH, "utf-8")) as unknown;
    const normalized = normalizeStore(raw);
    const cleaned = cleanExpiredSnoozes(normalized);

    if (cleaned.snoozed.length !== normalized.snoozed.length) {
      saveMuted(cleaned);
    }

    return cleaned;
  } catch {
    return emptyStore();
  }
}

export function saveMuted(store: MutedStore): void {
  ensureScopeDir();
  writeFileSync(MUTED_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
}

export function isItemMuted(id: string): boolean {
  const store = loadMuted();
  return (
    store.muted.some((entry) => entry.id === id) ||
    store.snoozed.some((entry) => entry.id === id)
  );
}
