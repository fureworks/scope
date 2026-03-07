import { GitSignal, PRInfo } from "../sources/git.js";
import { CalendarEvent, FreeBlock } from "../sources/calendar.js";
import { IssueSignal } from "../sources/issues.js";
import { isItemMuted } from "../store/muted.js";
import { ScoringWeights, DEFAULT_WEIGHTS } from "../store/config.js";

export type Priority = "now" | "today" | "later";

export interface ScoredItem {
  priority: Priority;
  score: number;
  emoji: string;
  label: string;
  detail: string;
  reason: string;
  source: "git" | "calendar" | "pr" | "issue";
}

export interface PrioritizedOutput {
  now: ScoredItem[];
  today: ScoredItem[];
  ignored: Array<{ label: string; reason: string }>;
  readonly laterCount: number;
  freeBlocks: FreeBlock[];
  suggestions: string[];
}

interface CandidateItem extends ScoredItem {
  suppressionReason?: string;
}

function scorePR(pr: PRInfo, repoName: string): CandidateItem {
  let score = 0;
  const details: string[] = [];
  const ageDaysRounded = Math.round(pr.ageDays);
  let agePoints = 0;

  // Staleness
  if (pr.ageDays > 14) {
    agePoints = 9; // 2+ weeks = critical
    score += agePoints;
    details.push(`open ${ageDaysRounded} days`);
  } else if (pr.ageDays > 5) {
    agePoints = 7;
    score += agePoints;
    details.push(`open ${ageDaysRounded} days`);
  } else if (pr.ageDays > 2) {
    agePoints = 4;
    score += agePoints;
    details.push(`open ${ageDaysRounded} days`);
  }

  // Blocking potential
  const reviewPoints = pr.reviewRequested ? 8 : 0;
  const ciPoints = pr.ciStatus === "fail" ? 5 : 0;
  const conflictPoints = pr.hasConflicts ? 4 : 0;

  if (pr.reviewRequested) {
    score += reviewPoints;
    details.push("review requested");
  }
  if (pr.ciStatus === "fail") {
    score += ciPoints;
    details.push("CI failing");
  }
  if (pr.hasConflicts) {
    score += conflictPoints;
    details.push("has conflicts");
  }

  let reason = "Needs attention.";
  if (reviewPoints > agePoints && reviewPoints >= ciPoints && reviewPoints >= conflictPoints) {
    if (pr.ageDays > 5) {
      reason = `Someone's waiting on your review. ${ageDaysRounded} days stale.`;
    } else {
      reason = "Someone's waiting on your review.";
    }
  } else if (agePoints >= reviewPoints && agePoints >= ciPoints && agePoints >= conflictPoints) {
    if (pr.ageDays > 14) {
      reason = `Open ${ageDaysRounded} days. Getting stale.`;
    } else {
      reason = `Open ${ageDaysRounded} days.`;
    }
  } else if (ciPoints >= conflictPoints) {
    reason = "CI is failing. Fix or close.";
  } else if (conflictPoints > 0) {
    reason = "Merge conflicts detected. Rebase or close.";
  }

  const priority: Priority = score >= 8 ? "now" : score >= 4 ? "today" : "later";

  const suppressionReason =
    priority === "later"
      ? pr.ageDays <= 2 && !pr.reviewRequested
        ? "Fresh, no one's waiting"
        : pr.ciStatus === "pass"
          ? "On track, CI green"
          : undefined
      : undefined;

  return {
    priority,
    score,
    emoji: priority === "now" ? "🔴" : "🟡",
    label: `PR #${pr.number} on ${repoName}`,
    detail: `${pr.title} — ${details.join(", ")}`,
    reason,
    source: "pr",
    suppressionReason,
  };
}

function scoreRepoWork(signal: GitSignal): CandidateItem | null {
  if (signal.uncommittedFiles === 0) return null;

  let score = 0;
  const details: string[] = [];

  details.push(
    `${signal.uncommittedFiles} uncommitted file${signal.uncommittedFiles > 1 ? "s" : ""}`
  );

  // Staleness of uncommitted work
  const days = Math.round(signal.lastCommitAge / 24);
  let reason = "Uncommitted changes detected.";
  if (signal.lastCommitAge > 72) {
    score += 9; // 3+ days uncommitted = NOW
    details.push(`last commit ${days}d ago`);
    reason = `Uncommitted work for ${days} days. Commit or stash.`;
  } else if (signal.lastCommitAge > 24) {
    score += 6;
    details.push(`last commit ${days}d ago`);
    reason = `Uncommitted work for ${days} days. Commit or stash.`;
  } else if (signal.lastCommitAge > 4) {
    const hours = Math.round(signal.lastCommitAge);
    score += 3;
    details.push(`last touched ${hours}h ago`);
    reason = `Uncommitted work for ${hours} hours. Commit or stash.`;
  } else {
    score += 1;
  }

  const priority: Priority = score >= 8 ? "now" : score >= 4 ? "today" : "later";

  return {
    priority,
    score,
    emoji: priority === "now" ? "🔴" : "🟡",
    label: `${signal.repo}`,
    detail: details.join(", "),
    reason,
    source: "git",
    suppressionReason:
      priority === "later" ? "Recently touched, nothing stale" : undefined,
  };
}

function scoreCalendarEvent(event: CalendarEvent): ScoredItem | null {
  // Only surface upcoming events (not past ones)
  if (event.minutesUntilStart < -15) return null;

  let score = 0;
  let reason = "Upcoming calendar event.";

  if (event.minutesUntilStart <= 60 && event.minutesUntilStart > 0) {
    score += 10;
    reason = `Starting in ${event.minutesUntilStart} minutes.`;
  } else if (event.minutesUntilStart <= 0 && event.minutesUntilStart > -15) {
    score += 10; // Happening now
    reason = "Happening now.";
  } else {
    score += 5;
  }

  const priority: Priority = score >= 8 ? "now" : "today";

  let timeLabel: string;
  if (event.minutesUntilStart <= 0) {
    timeLabel = "happening now";
  } else if (event.minutesUntilStart < 60) {
    timeLabel = `in ${event.minutesUntilStart} min`;
  } else {
    const hours = Math.floor(event.minutesUntilStart / 60);
    const mins = event.minutesUntilStart % 60;
    timeLabel = `at ${event.startTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    if (hours > 0) timeLabel += ` (${hours}h${mins > 0 ? `${mins}m` : ""} from now)`;
  }

  return {
    priority,
    score,
    emoji: "🔴",
    label: `Meeting: ${event.title}`,
    detail: timeLabel,
    reason,
    source: "calendar",
  };
}

function scoreIssue(issue: IssueSignal): CandidateItem {
  let score = 0;
  const details: string[] = [];
  const ageDaysRounded = Math.round(issue.ageDays);
  let agePoints = 0;

  if (issue.ageDays > 14) {
    agePoints = 9;
    score += agePoints;
    details.push(`open ${ageDaysRounded} days`);
  } else if (issue.ageDays > 7) {
    agePoints = 7;
    score += agePoints;
    details.push(`open ${ageDaysRounded} days`);
  }

  const priorityLabel = issue.labels.find((label) =>
    ["urgent", "critical", "bug"].includes(label.toLowerCase())
  );
  const priorityPoints = priorityLabel ? 3 : 0;
  if (priorityLabel) {
    score += 3;
    details.push("priority label");
  }

  const priority: Priority = score >= 8 ? "now" : score >= 4 ? "today" : "later";
  const labels = issue.labels.length > 0 ? ` [${issue.labels.join(", ")}]` : "";
  let reason = "Assigned issue needs attention.";
  if (agePoints >= priorityPoints && agePoints > 0) {
    if (issue.ageDays > 14) {
      reason = `Open ${ageDaysRounded} days and assigned to you.`;
    } else {
      reason = `Open ${ageDaysRounded} days and assigned to you.`;
    }
  } else if (priorityLabel) {
    reason = `Marked ${priorityLabel}. Assigned to you.`;
  }

  return {
    priority,
    score,
    emoji: "📋",
    label: `Issue #${issue.number} on ${issue.repo}`,
    detail: `${issue.title}${labels}${details.length > 0 ? ` — ${details.join(", ")}` : ""}`,
    reason,
    source: "issue",
    suppressionReason:
      priority === "later" && issue.ageDays < 7 && !priorityLabel
        ? "Less than a week old, no priority label"
        : undefined,
  };
}

export function prioritize(
  gitSignals: GitSignal[],
  calendarEvents: CalendarEvent[],
  freeBlocks: FreeBlock[],
  issues: IssueSignal[],
  weights: ScoringWeights = DEFAULT_WEIGHTS
): PrioritizedOutput {
  const allItems: CandidateItem[] = [];

  // Score calendar events
  for (const event of calendarEvents) {
    const scored = scoreCalendarEvent(event);
    if (scored) allItems.push(scored);
  }

  // Score git repos
  for (const signal of gitSignals) {
    // Score uncommitted work
    const gitItemId = `git:${signal.repo}`;
    const repoItem = isItemMuted(gitItemId) ? null : scoreRepoWork(signal);
    if (repoItem) allItems.push(repoItem);

    // Score PRs
    for (const pr of signal.openPRs) {
      const prItemId = `pr:${signal.repo}#${pr.number}`;
      if (isItemMuted(prItemId)) continue;
      allItems.push(scorePR(pr, signal.repo));
    }
  }

  // Score issues
  for (const issue of issues) {
    const issueItemId = `issue:${issue.repo}#${issue.number}`;
    if (isItemMuted(issueItemId)) continue;
    const scored = scoreIssue(issue);
    if (scored) allItems.push(scored);
  }

  // Apply weight multipliers based on source type
  for (const item of allItems) {
    if (item.source === "git") {
      item.score = Math.round(item.score * weights.staleness);
    } else if (item.source === "pr") {
      // PRs have both staleness and blocking components — use the higher weight
      item.score = Math.round(item.score * Math.max(weights.staleness, weights.blocking));
    } else if (item.source === "calendar") {
      item.score = Math.round(item.score * weights.timePressure);
    } else if (item.source === "issue") {
      item.score = Math.round(item.score * weights.staleness);
    }
    // Recalculate priority tier after weight adjustment
    item.priority = item.score >= 8 ? "now" : item.score >= 4 ? "today" : "later";
  }

  // Sort by score descending
  allItems.sort((a, b) => b.score - a.score);

  // Cap output: max 3 NOW items, max 5 TODAY items. Rest goes to later.
  const allNow = allItems.filter((i) => i.priority === "now");
  const allToday = allItems.filter((i) => i.priority === "today");
  const allLater = allItems.filter((i) => i.priority === "later");

  const now = allNow.slice(0, 3);
  const todayOverflow = allNow.slice(3);
  const today = [...todayOverflow, ...allToday].slice(0, 5);
  const capped = [...todayOverflow, ...allToday].slice(5);
  const ignored = [
    ...allLater.map((item) => ({
      label: item.label,
      reason: item.suppressionReason ?? "Lower priority than your top items",
    })),
    ...capped.map((item) => ({
      label: item.label,
      reason: "Lower priority than your top items",
    })),
  ];

  // Generate suggestions
  const suggestions: string[] = [];
  if (freeBlocks.length > 0) {
    const biggestBlock = freeBlocks.reduce((a, b) =>
      a.durationMinutes > b.durationMinutes ? a : b
    );
    const blockStart = biggestBlock.start.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const blockEnd = biggestBlock.end.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const hours = Math.floor(biggestBlock.durationMinutes / 60);
    const mins = biggestBlock.durationMinutes % 60;
    const durationStr = hours > 0 ? `${hours}h${mins > 0 ? `${mins}m` : ""}` : `${mins}m`;

    // Find a good item to suggest for this block
    const deepWorkItem = today.find((i) => i.source === "git");
    if (deepWorkItem) {
      suggestions.push(
        `${durationStr} free block (${blockStart}–${blockEnd}). Good for: ${deepWorkItem.label}`
      );
    } else {
      suggestions.push(
        `${durationStr} free block available (${blockStart}–${blockEnd})`
      );
    }
  }

  return {
    now,
    today,
    ignored,
    get laterCount() {
      return this.ignored.length;
    },
    freeBlocks,
    suggestions,
  };
}
