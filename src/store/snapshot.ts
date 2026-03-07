import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ScoredItem } from "../engine/prioritize.js";

const SNAPSHOTS_DIR = join(homedir(), ".scope", "snapshots");

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface DaySnapshot {
  date: string;
  timestamp: string;
  now: ScoredItem[];
  today: ScoredItem[];
}

export function saveSnapshot(now: ScoredItem[], today: ScoredItem[]): void {
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  const snapshot: DaySnapshot = {
    date: todayKey(),
    timestamp: new Date().toISOString(),
    now,
    today,
  };
  const file = join(SNAPSHOTS_DIR, `${todayKey()}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2));
}

export function loadSnapshot(): DaySnapshot | null {
  const file = join(SNAPSHOTS_DIR, `${todayKey()}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as DaySnapshot;
  } catch {
    return null;
  }
}
