import chalk from "chalk";
import {
  loadMuted,
  saveMuted,
  type MuteEntry,
  type SnoozeEntry,
} from "../store/muted.js";

interface SnoozeOptions {
  until: string;
}

interface MuteOptions {
  list?: boolean;
  clear?: string;
}

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export function parseUntilDate(input: string): Date {
  const normalized = input.trim().toLowerCase();
  const now = new Date();

  if (normalized === "tomorrow") {
    const tomorrow = new Date(now);
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  }

  const dayIndex = DAY_NAMES.indexOf(
    normalized as (typeof DAY_NAMES)[number]
  );
  if (dayIndex >= 0) {
    const target = new Date(now);
    target.setHours(0, 0, 0, 0);
    const delta = (dayIndex - target.getDay() + 7) % 7 || 7;
    target.setDate(target.getDate() + delta);
    return target;
  }

  const relative = normalized.match(/^(\d+)([dw])$/);
  if (relative) {
    const amount = Number.parseInt(relative[1], 10);
    const unit = relative[2];
    const days = unit === "w" ? amount * 7 : amount;
    const target = new Date(now);
    target.setDate(target.getDate() + days);
    return target;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const target = new Date(`${normalized}T00:00:00`);
    if (!Number.isNaN(target.getTime())) {
      return target;
    }
  }

  throw new Error(
    "Invalid --until value. Use: tomorrow, monday-sunday, 3d, 1w, or YYYY-MM-DD."
  );
}

function isValidItemId(id: string): boolean {
  return (
    /^(pr|issue):[^#\s]+#\d+$/.test(id) ||
    /^git:[^\s]+$/.test(id)
  );
}

function upsertSnooze(snoozed: SnoozeEntry[], entry: SnoozeEntry): SnoozeEntry[] {
  return [...snoozed.filter((existing) => existing.id !== entry.id), entry];
}

function upsertMute(muted: MuteEntry[], entry: MuteEntry): MuteEntry[] {
  return [...muted.filter((existing) => existing.id !== entry.id), entry];
}

function printList(): void {
  const store = loadMuted();

  console.log("");
  console.log(chalk.bold("  Muted Items"));
  if (store.muted.length === 0) {
    console.log(chalk.dim("  (none)"));
  } else {
    for (const entry of store.muted) {
      console.log(`  - ${entry.id} ${chalk.dim(`(muted ${entry.created})`)}`);
    }
  }

  console.log("");
  console.log(chalk.bold("  Snoozed Items"));
  if (store.snoozed.length === 0) {
    console.log(chalk.dim("  (none)"));
  } else {
    for (const entry of store.snoozed) {
      console.log(`  - ${entry.id} ${chalk.dim(`(until ${entry.until})`)}`);
    }
  }
  console.log("");
}

function clearItem(id: string): void {
  if (!isValidItemId(id)) {
    console.log(
      chalk.yellow(
        "  Invalid item id. Use pr:repo#123, issue:repo#123, or git:repo.\n"
      )
    );
    return;
  }

  const store = loadMuted();
  const next = {
    muted: store.muted.filter((entry) => entry.id !== id),
    snoozed: store.snoozed.filter((entry) => entry.id !== id),
  };
  saveMuted(next);

  if (
    next.muted.length === store.muted.length &&
    next.snoozed.length === store.snoozed.length
  ) {
    console.log(chalk.dim(`  No entry found for ${id}\n`));
    return;
  }

  console.log(chalk.green(`  Cleared: ${id}\n`));
}

export async function snoozeCommand(
  itemId: string,
  options: SnoozeOptions
): Promise<void> {
  if (!isValidItemId(itemId)) {
    console.log(
      chalk.yellow(
        "  Invalid item id. Use pr:repo#123, issue:repo#123, or git:repo.\n"
      )
    );
    return;
  }

  let untilDate: Date;
  try {
    untilDate = parseUntilDate(options.until);
  } catch (error) {
    console.log(chalk.yellow(`  ${(error as Error).message}\n`));
    return;
  }

  if (untilDate.getTime() <= Date.now()) {
    console.log(chalk.yellow("  --until must resolve to a future time.\n"));
    return;
  }

  const nowIso = new Date().toISOString();
  const untilIso = untilDate.toISOString();
  const store = loadMuted();

  const next = {
    muted: store.muted.filter((entry) => entry.id !== itemId),
    snoozed: upsertSnooze(store.snoozed, {
      id: itemId,
      until: untilIso,
      created: nowIso,
    }),
  };
  saveMuted(next);

  console.log(chalk.green(`  Snoozed ${itemId} until ${untilIso}\n`));
}

export async function muteCommand(
  itemId: string | undefined,
  options: MuteOptions
): Promise<void> {
  if (options.list) {
    printList();
    return;
  }

  if (options.clear) {
    clearItem(options.clear);
    return;
  }

  if (!itemId) {
    console.log(
      chalk.yellow(
        "  Missing item id. Use: scope mute <item-id>, scope mute --list, or scope mute --clear <item-id>.\n"
      )
    );
    return;
  }

  if (!isValidItemId(itemId)) {
    console.log(
      chalk.yellow(
        "  Invalid item id. Use pr:repo#123, issue:repo#123, or git:repo.\n"
      )
    );
    return;
  }

  const nowIso = new Date().toISOString();
  const store = loadMuted();
  const next = {
    snoozed: store.snoozed.filter((entry) => entry.id !== itemId),
    muted: upsertMute(store.muted, { id: itemId, created: nowIso }),
  };
  saveMuted(next);

  console.log(chalk.green(`  Muted ${itemId}\n`));
}
