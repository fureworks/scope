import { simpleGit, SimpleGit } from "simple-git";
import { existsSync } from "node:fs";

export interface GitSignal {
  repo: string;
  branch: string;
  uncommittedFiles: number;
  lastCommitAge: number; // hours since last commit
  staleBranches: string[]; // branches untouched > 3 days
  openPRs: PRInfo[];
}

export interface PRInfo {
  number: number;
  title: string;
  url: string;
  ageDays: number;
  reviewRequested: boolean;
  ciStatus: "pass" | "fail" | "pending" | "unknown";
  hasConflicts: boolean;
}

export async function scanRepo(repoPath: string): Promise<GitSignal | null> {
  if (!existsSync(repoPath)) {
    return null;
  }

  const git: SimpleGit = simpleGit(repoPath);

  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return null;

    // Get current branch
    const branchInfo = await git.branch();
    const branch = branchInfo.current;

    // Get uncommitted changes
    const status = await git.status();
    const uncommittedFiles =
      status.modified.length +
      status.not_added.length +
      status.created.length +
      status.deleted.length;

    // Get last commit time
    let lastCommitAge = 0;
    try {
      const log = await git.log({ maxCount: 1 });
      if (log.latest?.date) {
        const lastCommitDate = new Date(log.latest.date);
        lastCommitAge =
          (Date.now() - lastCommitDate.getTime()) / (1000 * 60 * 60);
      }
    } catch {
      // No commits yet
    }

    // Get stale branches (untouched > 3 days)
    const staleBranches: string[] = [];
    try {
      const branches = await git.branch(["-a", "--sort=-committerdate"]);
      const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;

      for (const branchName of branches.all) {
        if (branchName === branch) continue;
        if (branchName.startsWith("remotes/")) continue;

        try {
          const branchLog = await git.log({
            maxCount: 1,
            from: branchName,
          });
          if (branchLog.latest?.date) {
            const branchDate = new Date(branchLog.latest.date);
            if (branchDate.getTime() < threeDaysAgo) {
              staleBranches.push(branchName);
            }
          }
        } catch {
          // Skip branches we can't read
        }
      }
    } catch {
      // Branch listing failed
    }

    // Get open PRs via gh CLI
    const openPRs = await getOpenPRs(repoPath);

    const repoName = repoPath.split("/").pop() || repoPath;

    return {
      repo: repoName,
      branch,
      uncommittedFiles,
      lastCommitAge,
      staleBranches: staleBranches.slice(0, 5), // Cap at 5
      openPRs,
    };
  } catch {
    return null;
  }
}

async function getOpenPRs(repoPath: string): Promise<PRInfo[]> {
  try {
    const { execSync } = await import("node:child_process");
    const result = execSync(
      `gh pr list --json number,title,url,createdAt,reviewRequests,statusCheckRollup,mergeable --limit 10`,
      {
        cwd: repoPath,
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    const prs = JSON.parse(result) as Array<{
      number: number;
      title: string;
      url: string;
      createdAt: string;
      reviewRequests: Array<{ login?: string }>;
      statusCheckRollup: Array<{ conclusion: string }> | null;
      mergeable: string;
    }>;

    return prs.map((pr) => {
      const ageDays =
        (Date.now() - new Date(pr.createdAt).getTime()) /
        (1000 * 60 * 60 * 24);

      let ciStatus: PRInfo["ciStatus"] = "unknown";
      if (pr.statusCheckRollup && pr.statusCheckRollup.length > 0) {
        const hasFailure = pr.statusCheckRollup.some(
          (c) => c.conclusion === "FAILURE"
        );
        const allSuccess = pr.statusCheckRollup.every(
          (c) => c.conclusion === "SUCCESS"
        );
        if (hasFailure) ciStatus = "fail";
        else if (allSuccess) ciStatus = "pass";
        else ciStatus = "pending";
      }

      return {
        number: pr.number,
        title: pr.title,
        url: pr.url,
        ageDays: Math.round(ageDays * 10) / 10,
        reviewRequested: pr.reviewRequests.length > 0,
        ciStatus,
        hasConflicts: pr.mergeable === "CONFLICTING",
      };
    });
  } catch {
    // gh CLI not available or not in a repo with remote
    return [];
  }
}

export async function scanAllRepos(
  repoPaths: string[]
): Promise<GitSignal[]> {
  const results = await Promise.all(repoPaths.map(scanRepo));
  return results.filter((r): r is GitSignal => r !== null);
}
