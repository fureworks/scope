import chalk from "chalk";
import { loadConfig, configExists } from "../store/config.js";
import { saveSnapshot } from "../store/snapshot.js";
import { scanAllRepos } from "../sources/git.js";
import { getCalendarToday } from "../sources/calendar.js";
import { scanAssignedIssues } from "../sources/issues.js";
import { prioritize } from "../engine/prioritize.js";

interface TodayOptions {
  calendar?: boolean;
  json?: boolean;
}

export async function todayCommand(options: TodayOptions): Promise<void> {
  if (!configExists()) {
    console.log(
      chalk.yellow(
        "  Scope isn't set up yet. Run `scope onboard` to get started.\n"
      )
    );
    process.exit(1);
  }

  const config = loadConfig();

  if (config.repos.length === 0) {
    console.log(
      chalk.yellow("  No repos configured. Run `scope config git` to add some.\n")
    );
    process.exit(1);
  }

  // Scan git repos
  const gitSignals = await scanAllRepos(config.repos);

  // Get calendar events
  let calendarEvents: Awaited<ReturnType<typeof getCalendarToday>> = null;
  if (options.calendar !== false && config.calendar.enabled) {
    calendarEvents = await getCalendarToday();
    if (!calendarEvents) {
      console.log(
        chalk.dim(
          "  ⚠ Calendar not available. Try: gws auth login\n"
        )
      );
    }
  }

  const events = calendarEvents?.events ?? [];
  const freeBlocks = calendarEvents?.freeBlocks ?? [];
  const issueScan = await scanAssignedIssues();
  if (!issueScan.available) {
    console.log(
      chalk.dim("  ⚠ GitHub issues not available. Install/auth gh to enable issue signals.\n")
    );
  }

  // Prioritize
  const result = prioritize(gitSignals, events, freeBlocks, issueScan.issues);

  // Save snapshot for scope review
  saveSnapshot(result.now, result.today);

  // Output
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("");

  // NOW section
  if (result.now.length > 0) {
    console.log(chalk.bold("  NOW"));
    console.log(chalk.dim("  ───"));
    for (const item of result.now) {
      console.log(`  ${item.emoji} ${chalk.bold(item.label)}`);
      console.log(`     ${chalk.dim(item.detail)}`);
    }
    console.log("");
  }

  // TODAY section
  if (result.today.length > 0) {
    console.log(chalk.bold("  TODAY"));
    console.log(chalk.dim("  ────"));
    for (const item of result.today) {
      console.log(`  ${item.emoji} ${chalk.bold(item.label)}`);
      console.log(`     ${chalk.dim(item.detail)}`);
    }
    console.log("");
  }

  // IGNORED section
  if (result.ignored.length > 0) {
    console.log(chalk.bold("  IGNORED"));
    console.log(chalk.dim("  ───────"));
    const shown = result.ignored.slice(0, 10);
    for (const item of shown) {
      console.log(chalk.dim(`  ✗ ${item.label} — ${item.reason}`));
    }
    if (result.ignored.length > shown.length) {
      console.log(chalk.dim(`  and ${result.ignored.length - shown.length} more`));
    }
    console.log("");
  }

  if (result.now.length === 0) {
    console.log(chalk.dim("  Nothing else needs you today.\n"));
  }

  // Suggestions
  if (result.suggestions.length > 0) {
    for (const suggestion of result.suggestions) {
      console.log(`  💡 ${suggestion}`);
    }
    console.log("");
  }

  // Later count
  if (result.ignored.length > 0) {
    console.log(
      chalk.dim(`  ${result.ignored.length} other items can wait → scope status\n`)
    );
  }
}
