import chalk from "chalk";
import { loadConfig, configExists } from "../store/config.js";
import { loadSnapshot } from "../store/snapshot.js";
import { scanAllRepos } from "../sources/git.js";
import { scanAssignedIssues } from "../sources/issues.js";
import { getTodayCommits, getTodayPRActivity, getTodayIssueActivity } from "../sources/activity.js";
import type { RepoActivity, PRActivity, IssueActivity } from "../sources/activity.js";

interface ReviewOptions {
  json?: boolean;
}

interface ReviewOutput {
  done: string[];
  stillOpen: string[];
  tomorrow: string[];
  stats: { doneCount: number; carryOverCount: number };
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

  // Gather today's activity across all repos
  const commitActivities: RepoActivity[] = [];
  const prActivities: PRActivity[] = [];
  const issueActivities: IssueActivity[] = [];

  for (const repoPath of config.repos) {
    const [commits, prs, issues] = await Promise.all([
      getTodayCommits(repoPath),
      getTodayPRActivity(repoPath),
      getTodayIssueActivity(repoPath),
    ]);
    if (commits && commits.commitsToday > 0) commitActivities.push(commits);
    if (prs) prActivities.push(prs);
    if (issues) issueActivities.push(issues);
  }

  // Build "done" items
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

  // Build "still open" — compare against morning snapshot
  const stillOpen: string[] = [];
  const snapshot = loadSnapshot();

  if (snapshot) {
    // Get current state of repos
    const currentSignals = await scanAllRepos(config.repos);
    const currentIssues = await scanAssignedIssues();

    // Check which morning NOW/TODAY items are still unresolved
    const morningItems = [...snapshot.now, ...snapshot.today];

    for (const item of morningItems) {
      if (item.source === "calendar") continue; // Meetings are done once past

      if (item.source === "git") {
        // Check if repo still has uncommitted work
        const signal = currentSignals.find((s) => s.repo === item.label);
        if (signal && signal.uncommittedFiles > 0) {
          stillOpen.push(`${item.label} — ${signal.uncommittedFiles} uncommitted file${signal.uncommittedFiles > 1 ? "s" : ""}`);
        }
      }

      if (item.source === "pr") {
        // Check if PR is still open
        const prMatch = item.label.match(/PR #(\d+) on (.+)/);
        if (prMatch) {
          const prNum = parseInt(prMatch[1], 10);
          const repoName = prMatch[2];
          const signal = currentSignals.find((s) => s.repo === repoName);
          if (signal) {
            const prStillOpen = signal.openPRs.find((p) => p.number === prNum);
            if (prStillOpen) {
              stillOpen.push(`${item.label} — ${item.detail}`);
            }
          }
        }
      }

      if (item.source === "issue") {
        // Check if issue is still in the open list
        const issueMatch = item.label.match(/Issue #(\d+)/);
        if (issueMatch) {
          const issueNum = parseInt(issueMatch[1], 10);
          const stillExists = currentIssues.issues.find((i) => i.number === issueNum);
          if (stillExists) {
            stillOpen.push(`${item.label} — still open`);
          }
        }
      }
    }
  }

  // Build "tomorrow" suggestions
  const tomorrow: string[] = [];

  // Stale PRs that need attention
  const currentSignals = await scanAllRepos(config.repos);
  for (const signal of currentSignals) {
    for (const pr of signal.openPRs) {
      if (pr.ageDays > 5) {
        tomorrow.push(`Follow up on PR #${pr.number} on ${signal.repo} (${Math.round(pr.ageDays)}d old)`);
      }
    }
  }

  // Stale issues
  const currentIssues = await scanAssignedIssues();
  const staleIssues = currentIssues.issues.filter((i) => i.ageDays > 7);
  if (staleIssues.length > 0) {
    tomorrow.push(`${staleIssues.length} issue${staleIssues.length > 1 ? "s" : ""} trending stale across repos`);
  }

  const stats = {
    doneCount: done.length,
    carryOverCount: stillOpen.length,
  };

  const output: ReviewOutput = { done, stillOpen, tomorrow, stats };

  // Output
  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log("");

  if (done.length === 0 && stillOpen.length === 0) {
    console.log(chalk.dim("  Quiet day. No activity detected across watched repos.\n"));
    return;
  }

  // DONE TODAY
  if (done.length > 0) {
    console.log(chalk.bold("  DONE TODAY"));
    console.log(chalk.dim("  ──────────"));
    for (const item of done) {
      console.log(`  ${chalk.green("✓")} ${item}`);
    }
    console.log("");
  }

  // STILL OPEN
  if (stillOpen.length > 0) {
    console.log(chalk.bold("  STILL OPEN"));
    console.log(chalk.dim("  ──────────"));
    for (const item of stillOpen) {
      console.log(`  ${chalk.yellow("→")} ${item}`);
    }
    console.log("");
  }

  // TOMORROW
  if (tomorrow.length > 0) {
    console.log(chalk.bold("  TOMORROW"));
    console.log(chalk.dim("  ────────"));
    for (const item of tomorrow) {
      console.log(`  📋 ${item}`);
    }
    console.log("");
  }

  // Summary line
  console.log(
    chalk.dim(
      `  ─────────────\n  ${stats.doneCount} item${stats.doneCount !== 1 ? "s" : ""} done · ${stats.carryOverCount} carrying over\n`
    )
  );
}
