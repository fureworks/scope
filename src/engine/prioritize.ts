import { GitSignal, PRInfo } from "../sources/git.js";
import { CalendarEvent, FreeBlock } from "../sources/calendar.js";
import { IssueSignal } from "../sources/issues.js";
import { isItemMuted } from "../store/muted.js";
import { ScoringWeights, DEFAULT_WEIGHTS } from "../store/config.js";

export type Priority = "now" | "today" | "later";

export interface ScoredItem {
  id: string; // machine-readable: "pr:repo#N", "issue:repo#N", "git:repo", "cal:title"
  priority: Priority;
  score: number;
  emoji: string;
  label: string;
  detail: string;
  reason: string;
  confidence: "high" | "medium" | "low";
  confidenceNote?: string;
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

// Label patterns → score boost (case-insensitive substring match)
const LABEL_BOOSTS: Array<{ pattern: string; boost: number }> = [
  { pattern: "p0", boost: 15 },
  { pattern: "critical", boost: 15 },
  { pattern: "blocker", boost: 15 },
  { pattern: "security", boost: 12 },
  { pattern: "compliance", boost: 12 },
  { pattern: "p1", boost: 10 },
  { pattern: "bug", boost: 8 },
  { pattern: "p2", boost: 4 },
  { pattern: "enhancement", boost: 2 },
];

function getLabelBoost(labels: string[]): number {
  let maxBoost = 0;
  for (const label of labels) {
    const lower = label.toLowerCase();
    for (const { pattern, boost } of LABEL_BOOSTS) {
      // Word-boundary match: "p1" matches "p1-important" but not "p10"
      const re = new RegExp(`(^|[^a-z0-9])${pattern}($|[^a-z0-9])`);
      if (re.test(lower) && boost > maxBoost) {
        maxBoost = boost;
      }
    }
  }
  return maxBoost;
}

function scoreMyPR(pr: PRInfo, repoName: string): CandidateItem | null {
  // Only surface if there's a review decision worth acting on
  if (!pr.reviewDecision || pr.reviewDecision === "REVIEW_REQUIRED") return null;

  let score = 0;
  let reason = "";
  const details: string[] = [];

  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    score = 28; // High — someone reviewed and wants changes
    reason = "Changes requested on your PR. Respond to reviewer.";
    details.push("changes requested");
  } else if (pr.reviewDecision === "APPROVED") {
    score = 18; // Medium — ready to merge, don't let it sit
    reason = "Your PR is approved. Merge it.";
    details.push("approved, ready to merge");
  }

  if (pr.ciStatus === "fail") {
    score += 5;
    details.push("CI failing");
  }

  if (score === 0) return null;

  const priority: Priority = score >= 25 ? "now" : score >= 12 ? "today" : "later";

  return {
    priority,
    score,
    emoji: pr.reviewDecision === "CHANGES_REQUESTED" ? "🔴" : "🟢",
    id: `mypr:${repoName}#${pr.number}`,
    label: `Your PR #${pr.number} on ${repoName}`,
    detail: `${pr.title} — ${details.join(", ")}`,
    reason,
    confidence: "high" as const,
    source: "pr",
    suppressionReason: undefined,
  };
}

function scorePR(pr: PRInfo, repoName: string): CandidateItem {
  let score = 0;
  const details: string[] = [];
  const ageDaysRounded = Math.round(pr.ageDays);

  // Graduated staleness — scales with age, not step-function
  let agePoints = 0;
  if (pr.ageDays > 2) {
    agePoints = Math.min(30, Math.round(pr.ageDays * 0.6));
    score += agePoints;
    details.push(`open ${ageDaysRounded} days`);
  }

  // Blocking potential (scaled up proportionally)
  const reviewPoints = pr.reviewRequested ? 15 : 0;
  const ciPoints = pr.ciStatus === "fail" ? 10 : 0;
  const conflictPoints = pr.hasConflicts ? 8 : 0;

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

  // Label-based boost (#23, #25)
  const labelBoost = getLabelBoost(pr.labels ?? []);
  if (labelBoost > 0) {
    score += labelBoost;
    details.push("priority label");
  }

  // APPROVED + MERGEABLE boost — free value waiting to be captured
  const approvedBoost = pr.reviewDecision === "APPROVED" && !pr.hasConflicts ? 20 : 0;
  if (approvedBoost > 0) {
    score += approvedBoost;
    details.push("approved, ready to merge");
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
  } else if (approvedBoost > 0) {
    reason = "Approved and ready to merge. Ship it.";
  }

  // Updated thresholds for wider score range
  const priority: Priority = score >= 25 ? "now" : score >= 12 ? "today" : "later";

  const suppressionReason =
    priority === "later"
      ? pr.ageDays <= 2 && !pr.reviewRequested
        ? "Fresh, no one's waiting"
        : pr.ciStatus === "pass"
          ? "On track, CI green"
          : undefined
      : undefined;

  // Confidence: check for thin data
  // Fix #22: don't say "no reviewer assigned" when reviewDecision exists
  const missingContext: string[] = [];
  if (pr.ciStatus === "unknown") missingContext.push("no CI status");
  if (!pr.reviewRequested && !pr.reviewDecision && pr.ageDays > 2) {
    missingContext.push("no reviewer assigned");
  }
  const confidence: ScoredItem["confidence"] = missingContext.length >= 2 ? "low" : missingContext.length === 1 ? "medium" : "high";

  return {
    priority,
    score,
    emoji: priority === "now" ? "🔴" : "🟡",
    id: `pr:${repoName}#${pr.number}`,
    label: `PR #${pr.number} on ${repoName}`,
    detail: `${pr.title} — ${details.join(", ")}`,
    reason,
    confidence,
    confidenceNote: missingContext.length > 0 ? `low context: ${missingContext.join(", ")}` : undefined,
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

  // Staleness of uncommitted work (scaled to new range)
  const days = Math.round(signal.lastCommitAge / 24);
  let reason = "Uncommitted changes detected.";
  if (signal.lastCommitAge > 72) {
    score += 28; // 3+ days uncommitted = NOW
    details.push(`last commit ${days}d ago`);
    reason = `Uncommitted work for ${days} days. Commit or stash.`;
  } else if (signal.lastCommitAge > 24) {
    score += 18; // 1-3 days = TODAY
    details.push(`last commit ${days}d ago`);
    reason = `Uncommitted work for ${days} days. Commit or stash.`;
  } else if (signal.lastCommitAge > 4) {
    const hours = Math.round(signal.lastCommitAge);
    score += 8; // 4+ hours = low TODAY
    details.push(`last touched ${hours}h ago`);
    reason = `Uncommitted work for ${hours} hours. Commit or stash.`;
  } else {
    score += 3;
  }

  const priority: Priority = score >= 25 ? "now" : score >= 12 ? "today" : "later";

  return {
    priority,
    score,
    emoji: priority === "now" ? "🔴" : "🟡",
    id: `git:${signal.repo}`,
    label: `${signal.repo}`,
    detail: details.join(", "),
    reason,
    confidence: "high" as const, // git signals are always concrete
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

  if (event.minutesUntilStart <= 0 && event.minutesUntilStart > -15) {
    score += 30; // Happening now = always NOW
    reason = "Happening now.";
  } else if (event.minutesUntilStart <= 30) {
    score += 28; // <30 min = NOW
    reason = `Starting in ${event.minutesUntilStart} minutes.`;
  } else if (event.minutesUntilStart <= 60) {
    score += 20; // <60 min = TODAY (high)
    reason = `Starting in ${event.minutesUntilStart} minutes.`;
  } else {
    score += 14; // >60 min = TODAY (low)
  }

  const priority: Priority = score >= 25 ? "now" : "today";

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
    id: `cal:${event.title.replace(/\s+/g, "-").toLowerCase()}`,
    label: `Meeting: ${event.title}`,
    detail: timeLabel,
    reason,
    confidence: "high" as const, // calendar events are factual
    source: "calendar",
  };
}

function scoreIssue(issue: IssueSignal): CandidateItem {
  let score = 0;
  const details: string[] = [];
  const ageDaysRounded = Math.round(issue.ageDays);

  // Graduated staleness — same as PRs
  let agePoints = 0;
  if (issue.ageDays > 2) {
    agePoints = Math.min(30, Math.round(issue.ageDays * 0.6));
    score += agePoints;
    details.push(`open ${ageDaysRounded} days`);
  }

  // Label-based boost (reuses same LABEL_BOOSTS as PRs)
  const labelBoost = getLabelBoost(issue.labels);
  if (labelBoost > 0) {
    score += labelBoost;
    details.push("priority label");
  }

  const priority: Priority = score >= 25 ? "now" : score >= 12 ? "today" : "later";
  const labels = issue.labels.length > 0 ? ` [${issue.labels.join(", ")}]` : "";
  
  let reason = "Issue needs attention.";
  if (agePoints > labelBoost && agePoints > 0) {
    reason = `Open ${ageDaysRounded} days. Getting stale.`;
  } else if (labelBoost > 0) {
    const topLabel = issue.labels.find((l) => getLabelBoost([l]) === labelBoost) || issue.labels[0];
    reason = `Marked ${topLabel}. Needs attention.`;
  }

  // Confidence: issues missing labels
  const issueMissing: string[] = [];
  if (issue.labels.length === 0) issueMissing.push("no labels");
  const issueConfidence: ScoredItem["confidence"] = issueMissing.length > 0 ? "medium" : "high";

  return {
    priority,
    score,
    emoji: "📋",
    id: `issue:${issue.repo}#${issue.number}`,
    label: `Issue #${issue.number} on ${issue.repo}`,
    detail: `${issue.title}${labels}${details.length > 0 ? ` — ${details.join(", ")}` : ""}`,
    reason,
    confidence: issueConfidence,
    confidenceNote: issueMissing.length > 0 ? `low context: ${issueMissing.join(", ")}` : undefined,
    source: "issue",
    suppressionReason:
      priority === "later" && issue.ageDays < 7 && labelBoost === 0
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

    // Score PRs (in the repo)
    for (const pr of signal.openPRs) {
      const prItemId = `pr:${signal.repo}#${pr.number}`;
      if (isItemMuted(prItemId)) continue;
      allItems.push(scorePR(pr, signal.repo));
    }

    // Score my PRs with inbound reviews
    for (const pr of signal.myPRs) {
      // Skip if already scored as an open PR (dedup)
      const prItemId = `mypr:${signal.repo}#${pr.number}`;
      const alreadyScored = signal.openPRs.some((p) => p.number === pr.number);
      if (alreadyScored || isItemMuted(prItemId)) continue;
      const scored = scoreMyPR(pr, signal.repo);
      if (scored) allItems.push(scored);
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
    item.priority = item.score >= 25 ? "now" : item.score >= 12 ? "today" : "later";

    // P0/critical/blocker floor: never lower than TODAY
    if (item.priority === "later" && item.detail?.includes("priority label")) {
      const hasHighPriorityLabel = (item.source === "pr" || item.source === "issue") &&
        item.detail?.match(/\b(P0|critical|blocker|security|compliance)\b/i);
      if (hasHighPriorityLabel) {
        item.priority = "today";
        item.score = Math.max(item.score, 12);
      }
    }
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
