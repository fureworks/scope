import chalk from "chalk";
import { compareSnapshotOutcomes } from "../engine/outcomes.js";
import { loadConfig, configExists } from "../store/config.js";
import { loadSnapshot, saveSnapshot } from "../store/snapshot.js";
import { scanAllRepos } from "../sources/git.js";
import { mergeIssueSignals, scanAllRepoIssues, scanAssignedIssues } from "../sources/issues.js";
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

  let snapshot = loadSnapshot();
  const config = loadConfig();

  if (!snapshot) {
    const autoSignals = await scanAllRepos(config.repos);
    const [autoRepoIssues, autoIssueScan] = await Promise.all([
      scanAllRepoIssues(config.repos),
      scanAssignedIssues(),
    ]);
    const autoIssues = mergeIssueSignals(autoRepoIssues, autoIssueScan.issues);
    const autoResult = prioritize(autoSignals, [], [], autoIssues, config.weights);
    saveSnapshot(autoResult.now, autoResult.today);
    console.log(chalk.dim("  No morning snapshot found. Created one now. Run diff again later to see changes.\n"));
    return;
  }

  const gitSignals = await scanAllRepos(config.repos);
  const [repoIssues, issueScan] = await Promise.all([
    scanAllRepoIssues(config.repos),
    scanAssignedIssues(),
  ]);
  const currentIssues = mergeIssueSignals(repoIssues, issueScan.issues);
  const current = prioritize(gitSignals, [], [], currentIssues, config.weights);
  const comparison = await compareSnapshotOutcomes({
    snapshotItems: [...snapshot.now, ...snapshot.today],
    snapshotTime: snapshot.timestamp,
    currentItems: [...current.now, ...current.today],
    gitSignals,
    currentIssues,
    repoPaths: config.repos,
  });

  if (options.json) {
    console.log(JSON.stringify(comparison, null, 2));
    return;
  }

  console.log("");
  console.log(chalk.dim(`  Compared against snapshot from ${new Date(snapshot.timestamp).toLocaleTimeString()}\n`));

  const sections: Array<{ title: string; line: string; items: typeof comparison.shipped }> = [
    {
      title: "SHIPPED",
      line: "  ───────",
      items: comparison.shipped,
    },
    {
      title: "COVERED BY OPEN PR",
      line: "  ──────────────────",
      items: comparison.coveredByOpenPr,
    },
    {
      title: "TRIAGED OFF NOW",
      line: "  ───────────────",
      items: comparison.triagedOffNow,
    },
    {
      title: "WAITING ON OWNER",
      line: "  ────────────────",
      items: comparison.waitingOwnerDecision,
    },
    {
      title: "WAITING ON INFRA",
      line: "  ────────────────",
      items: comparison.waitingInfra,
    },
  ];

  for (const section of sections) {
    if (section.items.length === 0) continue;
    console.log(chalk.bold(`  ${section.title}`));
    console.log(chalk.dim(section.line));
    for (const item of section.items) {
      console.log(`  ${chalk.green("✓")} ${item.label}`);
      if (item.outcomeReason) {
        console.log(`     ${chalk.dim(item.outcomeReason)}`);
      }
    }
    console.log("");
  }

  if (comparison.newItems.length > 0) {
    console.log(chalk.bold("  NEW"));
    console.log(chalk.dim("  ───"));
    for (const item of comparison.newItems) {
      console.log(`  ${chalk.yellow("+")} ${item.label} — ${item.detail}`);
    }
    console.log("");
  }

  if (comparison.persisted.length > 0) {
    console.log(chalk.bold("  UNCHANGED"));
    console.log(chalk.dim("  ─────────"));
    for (const item of comparison.persisted) {
      console.log(`  ${chalk.dim("·")} ${item.label}`);
    }
    console.log("");
  }

  const changedCount =
    comparison.shipped.length +
    comparison.coveredByOpenPr.length +
    comparison.triagedOffNow.length +
    comparison.waitingOwnerDecision.length +
    comparison.waitingInfra.length +
    comparison.newItems.length;

  if (changedCount === 0) {
    console.log(chalk.dim("  No changes since this morning.\n"));
    return;
  }

  console.log(
    chalk.dim(
      `  ${comparison.shipped.length} shipped · ${comparison.coveredByOpenPr.length} covered by PR · ${comparison.triagedOffNow.length} triaged · ${comparison.waitingOwnerDecision.length} waiting on owner · ${comparison.waitingInfra.length} waiting on infra · ${comparison.newItems.length} new · ${comparison.persisted.length} unchanged\n`
    )
  );
}
