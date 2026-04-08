import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ScoredItem } from "../engine/prioritize.js";
import type { OutcomeTrackedItem } from "../engine/outcomes.js";

const SNAPSHOTS_DIR = join(homedir(), ".scope", "snapshots");

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface DaySnapshot {
  date: string;
  timestamp: string;
  now: OutcomeTrackedItem[];
  today: OutcomeTrackedItem[];
}

export type TimeContext = "morning" | "midday" | "afternoon" | "evening";

export function getTimeContext(date: Date = new Date()): TimeContext {
  const hour = date.getHours();
  if (hour < 12) return "morning";
  if (hour < 14) return "midday";
  if (hour <= 17) return "afternoon";
  return "evening";
}

function stampItems(items: ScoredItem[], freshnessCheckedAt: string): OutcomeTrackedItem[] {
  return items.map((item) => ({
    ...item,
    freshnessCheckedAt,
  }));
}

function hydrateSnapshot(snapshot: DaySnapshot): DaySnapshot {
  return {
    ...snapshot,
    now: snapshot.now.map((item) => ({
      ...item,
      freshnessCheckedAt: item.freshnessCheckedAt ?? snapshot.timestamp,
    })),
    today: snapshot.today.map((item) => ({
      ...item,
      freshnessCheckedAt: item.freshnessCheckedAt ?? snapshot.timestamp,
    })),
  };
}

export function saveSnapshot(now: ScoredItem[], today: ScoredItem[]): void {
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString();
  const snapshot: DaySnapshot = {
    date: todayKey(),
    timestamp,
    now: stampItems(now, timestamp),
    today: stampItems(today, timestamp),
  };
  const file = join(SNAPSHOTS_DIR, `${todayKey()}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2));
}

export function loadSnapshot(): DaySnapshot | null {
  const file = join(SNAPSHOTS_DIR, `${todayKey()}.json`);
  if (!existsSync(file)) return null;
  try {
    return hydrateSnapshot(JSON.parse(readFileSync(file, "utf-8")) as DaySnapshot);
  } catch {
    return null;
  }
}
