import { simpleGit } from "simple-git";
import { existsSync } from "node:fs";

export interface RepoActivity {
  repo: string;
  commitsToday: number;
  commitMessages: string[];
  filesChanged: number;
}

export interface PRActivity {
  repo: string;
  merged: Array<{ number: number; title: string }>;
  opened: Array<{ number: number; title: string }>;
  closed: Array<{ number: number; title: string }>;
}

export interface IssueActivity {
  repo: string;
  closed: Array<{ number: number; title: string }>;
}

export async function getTodayCommits(repoPath: string): Promise<RepoActivity | null> {
  if (!existsSync(repoPath)) return null;

  const git = simpleGit(repoPath);

  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return null;

    const repoName = repoPath.split("/").pop() || repoPath;

    // Get today's commits
    const log = await git.log(["--since=midnight", "--all"]);

    if (!log.all || log.all.length === 0) {
      return { repo: repoName, commitsToday: 0, commitMessages: [], filesChanged: 0 };
    }

    const commitMessages = log.all.map((c) => c.message.split("\n")[0]);

    // Get files changed today
    let filesChanged = 0;
    try {
      const diffStat = await git.diff(["--stat", "--since=midnight", "HEAD"]);
      // Count lines that look like file changes (contain |)
      filesChanged = diffStat.split("\n").filter((l) => l.includes("|")).length;
    } catch {
      // Fallback: estimate from commit count
      filesChanged = 0;
    }

    return {
      repo: repoName,
      commitsToday: log.all.length,
      commitMessages,
      filesChanged,
    };
  } catch {
    return null;
  }
}

export async function getTodayPRActivity(repoPath: string): Promise<PRActivity | null> {
  const repoName = repoPath.split("/").pop() || repoPath;

  try {
    const { execSync } = await import("node:child_process");
    const today = new Date().toISOString().split("T")[0];

    // Merged today
    let merged: PRActivity["merged"] = [];
    try {
      const mergedRaw = execSync(
        `gh pr list --state merged --json number,title,mergedAt --limit 20`,
        { cwd: repoPath, encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }
      );
      const mergedPrs = JSON.parse(mergedRaw) as Array<{ number: number; title: string; mergedAt: string }>;
      merged = mergedPrs
        .filter((pr) => pr.mergedAt && pr.mergedAt.startsWith(today))
        .map((pr) => ({ number: pr.number, title: pr.title }));
    } catch { /* no merged PRs or gh not available */ }

    // Opened today
    let opened: PRActivity["opened"] = [];
    try {
      const openedRaw = execSync(
        `gh pr list --state open --json number,title,createdAt --limit 20`,
        { cwd: repoPath, encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }
      );
      const openedPrs = JSON.parse(openedRaw) as Array<{ number: number; title: string; createdAt: string }>;
      opened = openedPrs
        .filter((pr) => pr.createdAt && pr.createdAt.startsWith(today))
        .map((pr) => ({ number: pr.number, title: pr.title }));
    } catch { /* no opened PRs or gh not available */ }

    // Closed today (not merged)
    let closed: PRActivity["closed"] = [];
    try {
      const closedRaw = execSync(
        `gh pr list --state closed --json number,title,closedAt,mergedAt --limit 20`,
        { cwd: repoPath, encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }
      );
      const closedPrs = JSON.parse(closedRaw) as Array<{ number: number; title: string; closedAt: string; mergedAt: string | null }>;
      closed = closedPrs
        .filter((pr) => pr.closedAt && pr.closedAt.startsWith(today) && !pr.mergedAt)
        .map((pr) => ({ number: pr.number, title: pr.title }));
    } catch { /* no closed PRs or gh not available */ }

    if (merged.length === 0 && opened.length === 0 && closed.length === 0) return null;

    return { repo: repoName, merged, opened, closed };
  } catch {
    return null;
  }
}

export interface GitHubActivity {
  repo: string;
  prReviews: number;
  issueComments: number;
  prComments: number;
}

export async function getTodayGitHubActivity(repoPath: string): Promise<GitHubActivity | null> {
  const repoName = repoPath.split("/").pop() || repoPath;

  try {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);
    const today = new Date().toISOString().split("T")[0];

    let prReviews = 0;
    let issueComments = 0;
    let prComments = 0;

    // Count PR reviews submitted today
    try {
      const { stdout } = await execAsync(
        `gh api "repos/{owner}/{repo}/pulls/comments?since=${today}T00:00:00Z&per_page=100" --jq 'length'`,
        { cwd: repoPath, encoding: "utf-8", timeout: 10000 }
      );
      prComments = parseInt(stdout.trim(), 10) || 0;
    } catch { /* gh api not available or rate limited */ }

    // Count issue comments today
    try {
      const { stdout } = await execAsync(
        `gh api "repos/{owner}/{repo}/issues/comments?since=${today}T00:00:00Z&per_page=100" --jq 'length'`,
        { cwd: repoPath, encoding: "utf-8", timeout: 10000 }
      );
      issueComments = parseInt(stdout.trim(), 10) || 0;
    } catch { /* gh api not available or rate limited */ }

    if (prReviews === 0 && issueComments === 0 && prComments === 0) return null;

    return { repo: repoName, prReviews, issueComments, prComments };
  } catch {
    return null;
  }
}

export async function getTodayIssueActivity(repoPath: string): Promise<IssueActivity | null> {
  const repoName = repoPath.split("/").pop() || repoPath;

  try {
    const { execSync } = await import("node:child_process");
    const today = new Date().toISOString().split("T")[0];

    const result = execSync(
      `gh issue list --state closed --json number,title,closedAt --limit 20`,
      { cwd: repoPath, encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }
    );

    const issues = JSON.parse(result) as Array<{ number: number; title: string; closedAt: string }>;
    const closedToday = issues
      .filter((i) => i.closedAt && i.closedAt.startsWith(today))
      .map((i) => ({ number: i.number, title: i.title }));

    if (closedToday.length === 0) return null;

    return { repo: repoName, closed: closedToday };
  } catch {
    return null;
  }
}
