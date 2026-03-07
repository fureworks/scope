export interface IssueSignal {
  number: number;
  title: string;
  url: string;
  repo: string;
  ageDays: number;
  labels: string[];
}

export interface IssueScanResult {
  available: boolean;
  issues: IssueSignal[];
}

export async function scanAssignedIssues(): Promise<IssueScanResult> {
  try {
    const { execSync } = await import("node:child_process");

    try {
      execSync("which gh", { stdio: "pipe" });
    } catch {
      return { available: false, issues: [] };
    }

    const result = execSync(
      "gh issue list --assignee @me --state open --json number,title,url,createdAt,labels,repository --limit 20",
      {
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    const parsed = JSON.parse(result) as Array<{
      number: number;
      title: string;
      url: string;
      createdAt: string;
      labels?: Array<{ name?: string }>;
      repository?: { nameWithOwner?: string; name?: string };
    }>;

    const issues: IssueSignal[] = parsed.map((issue) => {
      const ageDays =
        (Date.now() - new Date(issue.createdAt).getTime()) /
        (1000 * 60 * 60 * 24);

      return {
        number: issue.number,
        title: issue.title,
        url: issue.url,
        repo: issue.repository?.nameWithOwner || issue.repository?.name || "unknown",
        ageDays: Math.round(ageDays * 10) / 10,
        labels: (issue.labels ?? []).map((label) => label.name || "").filter(Boolean),
      };
    });

    return { available: true, issues };
  } catch {
    return { available: true, issues: [] };
  }
}
