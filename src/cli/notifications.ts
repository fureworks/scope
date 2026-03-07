import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getScopeDir, ensureScopeDir } from "../store/config.js";

const LOG_PATH = join(getScopeDir(), "notifications.log");

interface NotificationEntry {
  timestamp: string;
  title: string;
  body: string;
  seen: boolean;
}

function parseLog(): NotificationEntry[] {
  if (!existsSync(LOG_PATH)) return [];

  const raw = readFileSync(LOG_PATH, "utf-8").trim();
  if (!raw) return [];

  return raw.split("\n").map((line) => {
    // Format: [2026-03-07T10:00:00.000Z] Title: Body
    const match = line.match(/^\[(.+?)\]\s*(.+?):\s*(.+)$/);
    if (match) {
      return {
        timestamp: match[1],
        title: match[2],
        body: match[3],
        seen: false,
      };
    }
    return {
      timestamp: new Date().toISOString(),
      title: "Notification",
      body: line,
      seen: false,
    };
  });
}

interface NotificationsOptions {
  clear?: boolean;
  all?: boolean;
}

export async function notificationsCommand(
  options: NotificationsOptions
): Promise<void> {
  if (options.clear) {
    ensureScopeDir();
    writeFileSync(LOG_PATH, "", "utf-8");
    console.log(chalk.green("\n  ✓ Notifications cleared.\n"));
    return;
  }

  const entries = parseLog();

  if (entries.length === 0) {
    console.log(chalk.dim("\n  No notifications. You're all clear.\n"));
    return;
  }

  // Show recent (last 24h unless --all)
  const cutoff = options.all
    ? 0
    : Date.now() - 24 * 60 * 60 * 1000;

  const filtered = entries.filter(
    (e) => new Date(e.timestamp).getTime() > cutoff
  );

  if (filtered.length === 0) {
    console.log(chalk.dim("\n  No notifications in the last 24 hours."));
    console.log(chalk.dim("  Use --all to see older ones.\n"));
    return;
  }

  console.log("");
  console.log(chalk.bold(`  Notifications (${filtered.length})`));
  console.log(chalk.dim("  ─────────────────────\n"));

  // Group by date
  const grouped = new Map<string, NotificationEntry[]>();
  for (const entry of filtered.reverse()) {
    const date = new Date(entry.timestamp).toLocaleDateString();
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date)!.push(entry);
  }

  for (const [date, items] of grouped) {
    console.log(chalk.dim(`  ${date}`));
    for (const item of items) {
      const time = new Date(item.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      console.log(`  ${chalk.dim(time)}  ${item.body}`);
    }
    console.log("");
  }

  console.log(
    chalk.dim(`  scope notifications --clear to dismiss all\n`)
  );
}
