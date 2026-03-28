import chalk from "chalk";
import { loadSnapshot, DaySnapshot } from "../store/snapshot.js";
import { loadConfig, configExists } from "../store/config.js";
import { scanAllRepos } from "../sources/git.js";
import { scanAssignedIssues } from "../sources/issues.js";
import { prioritize } from "../engine/prioritize.js";

interface DiffOptions {
  json?: boolean;
}

export async function diffCommand(options: DiffOptions): Promise<void> {
  if (!configExists()) {
    console.log(
      chalk.yellow("  Scope isn't set up yet. Run `scope onboard` to get started.\n")
    );
    process.exit(1);
  }

  const snapshot = loadSnapshot();
  if (!snapshot) {
    console.log(
      chalk.yellow("  No morning snapshot found. Run `scope today` first to create one.\n")
    );
    process.exit(1);
  }

  const config = loadConfig();
  const gitSignals = await scanAllRepos(config.repos);
  const issueScan = await scanAssignedIssues();
  const current = prioritize(gitSignals, [], [], issueScan.issues, config.weights);

  const morningKeys = new Set(
    [...snapshot.now, ...snapshot.today].map((i) => `${i.source}|${i.label}`)
  );
  const currentKeys = new Set(
    [...current.now, ...current.today].map((i) => `${i.source}|${i.label}`)
  );

  const resolved = [...snapshot.now, ...snapshot.today].filter(
    (i) => !currentKeys.has(`${i.source}|${i.label}`)
  );
  const newItems = [...current.now, ...current.today].filter(
    (i) => !morningKeys.has(`${i.source}|${i.label}`)
  );
  const persisted = [...current.now, ...current.today].filter(
    (i) => morningKeys.has(`${i.source}|${i.label}`)
  );

  if (options.json) {
    console.log(JSON.stringify({ resolved, newItems, persisted, snapshotTime: snapshot.timestamp }, null, 2));
    return;
  }

  console.log("");
  console.log(chalk.dim(`  Compared against snapshot from ${new Date(snapshot.timestamp).toLocaleTimeString()}\n`));

  if (resolved.length > 0) {
    console.log(chalk.bold("  RESOLVED"));
    console.log(chalk.dim("  ────────"));
    for (const item of resolved) {
      console.log(`  ${chalk.green("✓")} ${item.label}`);
    }
    console.log("");
  }

  if (newItems.length > 0) {
    console.log(chalk.bold("  NEW"));
    console.log(chalk.dim("  ───"));
    for (const item of newItems) {
      console.log(`  ${chalk.yellow("+")} ${item.label} — ${item.detail}`);
    }
    console.log("");
  }

  if (persisted.length > 0) {
    console.log(chalk.bold("  UNCHANGED"));
    console.log(chalk.dim("  ─────────"));
    for (const item of persisted) {
      console.log(`  ${chalk.dim("·")} ${item.label}`);
    }
    console.log("");
  }

  if (resolved.length === 0 && newItems.length === 0) {
    console.log(chalk.dim("  No changes since this morning.\n"));
  } else {
    console.log(
      chalk.dim(`  ${resolved.length} resolved · ${newItems.length} new · ${persisted.length} unchanged\n`)
    );
  }
}
