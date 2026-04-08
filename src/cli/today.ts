import chalk from "chalk";
import { loadConfig, configExists } from "../store/config.js";
import { getTimeContext, loadSnapshot, saveSnapshot } from "../store/snapshot.js";
import { scanAllRepos } from "../sources/git.js";
import { getCalendarToday } from "../sources/calendar.js";
import { mergeIssueSignals, scanAssignedIssues, scanAllRepoIssues } from "../sources/issues.js";
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
  // Scan issues from watched repos + assigned issues
  const [repoIssues, issueScan] = await Promise.all([
    scanAllRepoIssues(config.repos),
    scanAssignedIssues(),
  ]);
  if (!issueScan.available) {
    console.log(
      chalk.dim("  ⚠ GitHub issues not available. Install/auth gh to enable issue signals.\n")
    );
  }

  const allIssues = mergeIssueSignals(repoIssues, issueScan.issues);

  // Prioritize
  const result = prioritize(gitSignals, events, freeBlocks, allIssues, config.weights);

  const timeContext = getTimeContext();

  // Save snapshot on first call of the day (regardless of time)
  const existingSnapshot = loadSnapshot();
  if (!existingSnapshot) {
    saveSnapshot(result.now, result.today);
  }

  const snapshot =
    timeContext === "midday" || timeContext === "afternoon"
      ? loadSnapshot()
      : null;

  // Output
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("");

  if (result.now.length === 0 && result.today.length === 0) {
    if (timeContext === "evening") {
      console.log("  Day's winding down. Run `scope review` to wrap up.\n");
    } else {
      console.log(chalk.green("  ✓ Nothing urgent. You're clear.\n"));
    }

    // Show ignored items even when nothing is urgent
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

    console.log(chalk.dim("  Nothing else needs you today.\n"));
    return;
  }

  if (timeContext === "morning") {
    console.log("  Good morning. Here's what matters:\n");
  }

  // NOW section
  if (result.now.length > 0) {
    console.log(chalk.bold("  NOW"));
    console.log(chalk.dim("  ───"));
    for (const item of result.now) {
      const confTag = item.confidenceNote ? chalk.yellow(` (${item.confidenceNote})`) : "";
      console.log(`  ${item.emoji} ${chalk.bold(item.label)}${confTag}`);
      console.log(`     ${chalk.dim(item.detail)}`);
      console.log(`     ${chalk.dim(`Why: ${item.reason}`)}`);
    }
    console.log("");
  }

  // TODAY section
  if (result.today.length > 0) {
    console.log(chalk.bold("  TODAY"));
    console.log(chalk.dim("  ────"));
    for (const item of result.today) {
      const confTag = item.confidenceNote ? chalk.yellow(` (${item.confidenceNote})`) : "";
      console.log(`  ${item.emoji} ${chalk.bold(item.label)}${confTag}`);
      console.log(`     ${chalk.dim(item.detail)}`);
      console.log(`     ${chalk.dim(`Why: ${item.reason}`)}`);
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

  // Temporal context: progress tracking
  if (timeContext === "midday" && snapshot) {
    const total = snapshot.now.length + snapshot.today.length;
    console.log(`  You had ${total} items this morning. Check back later to see progress.\n`);
  }

  if (timeContext === "afternoon" && snapshot) {
    const morningItems = [...snapshot.now, ...snapshot.today];
    const currentKeys = new Set(
      [...result.now, ...result.today].map((item) => `${item.source}|${item.label}|${item.detail}`)
    );
    const left = morningItems.filter((item) =>
      currentKeys.has(`${item.source}|${item.label}|${item.detail}`)
    ).length;
    const total = morningItems.length;
    const done = total - left;
    console.log(`  ${done}/${total} from this morning done. ${left} remaining.\n`);
  }

  if (timeContext === "evening" && result.now.length > 0) {
    console.log("  Late day — consider if these can wait until tomorrow.\n");
  }
}
