import chalk from "chalk";
import { compareSnapshotOutcomes, type SnapshotComparison } from "../engine/outcomes.js";
import { loadConfig, configExists } from "../store/config.js";
import { loadSnapshot } from "../store/snapshot.js";
import { scanAllRepos } from "../sources/git.js";
import { getTodayCommits, getTodayPRActivity, getTodayIssueActivity, getTodayGitHubActivity } from "../sources/activity.js";
import type { RepoActivity, PRActivity, IssueActivity, GitHubActivity } from "../sources/activity.js";
import { mergeIssueSignals, scanAllRepoIssues, scanAssignedIssues } from "../sources/issues.js";
import { prioritize } from "../engine/prioritize.js";

interface ReviewOptions {
  json?: boolean;
}

interface ReviewOutput {
  done: string[];
  stillOpen: string[];
  tomorrow: string[];
  stats: { doneCount: number; carryOverCount: number };
  snapshotOutcomes?: SnapshotComparison;
}

export async function reviewCommand(options: ReviewOptions): Promise<void> {
  if (!configExists()) {
    console.log(
      chalk.yellow("  Scope isn't set up yet. Run `scope onboard` to get started.\n")
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

  const commitActivities: RepoActivity[] = [];
  const prActivities: PRActivity[] = [];
  const issueActivities: IssueActivity[] = [];
  const ghActivities: GitHubActivity[] = [];

  for (const repoPath of config.repos) {
    const [commits, prs, issues, ghActivity] = await Promise.all([
      getTodayCommits(repoPath),
      getTodayPRActivity(repoPath),
      getTodayIssueActivity(repoPath),
      getTodayGitHubActivity(repoPath),
    ]);
    if (commits && commits.commitsToday > 0) commitActivities.push(commits);
    if (prs) prActivities.push(prs);
    if (issues) issueActivities.push(issues);
    if (ghActivity) ghActivities.push(ghActivity);
  }

  const done: string[] = [];

  for (const activity of commitActivities) {
    const summary = activity.commitMessages.length <= 3
      ? activity.commitMessages.join(", ")
      : `${activity.commitMessages.slice(0, 3).join(", ")}…`;
    done.push(
      `${activity.commitsToday} commit${activity.commitsToday > 1 ? "s" : ""} on ${activity.repo} (${summary})`
    );
  }

  for (const pr of prActivities) {
    for (const m of pr.merged) {
      done.push(`PR #${m.number} merged on ${pr.repo} — ${m.title}`);
    }
    for (const o of pr.opened) {
      done.push(`PR #${o.number} opened on ${pr.repo} — ${o.title}`);
    }
    for (const c of pr.closed) {
      done.push(`PR #${c.number} closed on ${pr.repo} — ${c.title}`);
    }
  }

  for (const issue of issueActivities) {
    for (const c of issue.closed) {
      done.push(`Issue #${c.number} closed on ${issue.repo} — ${c.title}`);
    }
  }

  for (const gh of ghActivities) {
    const parts: string[] = [];
    if (gh.prComments > 0) parts.push(`${gh.prComments} PR comment${gh.prComments > 1 ? "s" : ""}`);
    if (gh.issueComments > 0) parts.push(`${gh.issueComments} issue comment${gh.issueComments > 1 ? "s" : ""}`);
    if (parts.length > 0) {
      done.push(`${parts.join(", ")} on ${gh.repo}`);
    }
  }

  const stillOpen: string[] = [];
  const snapshot = loadSnapshot();
  let snapshotOutcomes: SnapshotComparison | undefined;

  const currentSignals = await scanAllRepos(config.repos);
  const [repoIssues, assignedIssueScan] = await Promise.all([
    scanAllRepoIssues(config.repos),
    scanAssignedIssues(),
  ]);
  const currentIssues = mergeIssueSignals(repoIssues, assignedIssueScan.issues);

  if (snapshot) {
    const currentResult = prioritize(currentSignals, [], [], currentIssues, config.weights);
    snapshotOutcomes = await compareSnapshotOutcomes({
      snapshotItems: [...snapshot.now, ...snapshot.today],
      snapshotTime: snapshot.timestamp,
      currentItems: [...currentResult.now, ...currentResult.today],
      gitSignals: currentSignals,
      currentIssues,
      repoPaths: config.repos,
    });

    for (const item of snapshotOutcomes.persisted) {
      if (item.source === "calendar") continue;
      if (item.source === "git") {
        const signal = currentSignals.find((s) => s.repo === item.label);
        if (signal && signal.uncommittedFiles > 0) {
          stillOpen.push(`${item.label} — ${signal.uncommittedFiles} uncommitted file${signal.uncommittedFiles > 1 ? "s" : ""}`);
        }
        continue;
      }

      if (item.source === "pr" || item.source === "issue") {
        stillOpen.push(`${item.label} — ${item.detail}`);
      }
    }
  }

  const tomorrow: string[] = [];

  for (const signal of currentSignals) {
    for (const pr of signal.openPRs) {
      if (pr.ageDays > 5) {
        tomorrow.push(`Follow up on PR #${pr.number} on ${signal.repo} (${Math.round(pr.ageDays)}d old)`);
      }
    }
  }

  const staleIssues = currentIssues.filter((i) => i.ageDays > 7);
  if (staleIssues.length > 0) {
    tomorrow.push(`${staleIssues.length} issue${staleIssues.length > 1 ? "s" : ""} trending stale across repos`);
  }

  const stats = {
    doneCount: done.length,
    carryOverCount: stillOpen.length,
  };

  const output: ReviewOutput = { done, stillOpen, tomorrow, stats, snapshotOutcomes };

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log("");

  if (done.length === 0 && stillOpen.length === 0 && !snapshotOutcomes) {
    console.log(chalk.dim("  Quiet day. No activity detected across watched repos.\n"));
    return;
  }

  if (done.length > 0) {
    console.log(chalk.bold("  DONE TODAY"));
    console.log(chalk.dim("  ──────────"));
    for (const item of done) {
      console.log(`  ${chalk.green("✓")} ${item}`);
    }
    console.log("");
  }

  if (stillOpen.length > 0) {
    console.log(chalk.bold("  STILL OPEN"));
    console.log(chalk.dim("  ──────────"));
    for (const item of stillOpen) {
      console.log(`  ${chalk.yellow("→")} ${item}`);
    }
    console.log("");
  }

  if (snapshotOutcomes) {
    const outcomeSections: Array<{ title: string; line: string; items: typeof snapshotOutcomes.shipped }> = [
      { title: "  SHIPPED SINCE SNAPSHOT", line: "  ─────────────────────", items: snapshotOutcomes.shipped },
      { title: "  COVERED BY OPEN PR", line: "  ──────────────────", items: snapshotOutcomes.coveredByOpenPr },
      { title: "  TRIAGED OFF NOW", line: "  ───────────────", items: snapshotOutcomes.triagedOffNow },
      { title: "  WAITING ON OWNER", line: "  ────────────────", items: snapshotOutcomes.waitingOwnerDecision },
      { title: "  WAITING ON INFRA", line: "  ────────────────", items: snapshotOutcomes.waitingInfra },
    ];

    for (const section of outcomeSections) {
      if (section.items.length === 0) continue;
      console.log(chalk.bold(section.title));
      console.log(chalk.dim(section.line));
      for (const item of section.items) {
        console.log(`  ${chalk.green("✓")} ${item.label}`);
        if (item.outcomeReason) {
          console.log(`     ${chalk.dim(item.outcomeReason)}`);
        }
      }
      console.log("");
    }
  }

  if (tomorrow.length > 0) {
    console.log(chalk.bold("  TOMORROW"));
    console.log(chalk.dim("  ────────"));
    for (const item of tomorrow) {
      console.log(`  📋 ${item}`);
    }
    console.log("");
  }

  console.log(
    chalk.dim(
      `  ─────────────\n  ${stats.doneCount} item${stats.doneCount !== 1 ? "s" : ""} done · ${stats.carryOverCount} carrying over\n`
    )
  );
}
