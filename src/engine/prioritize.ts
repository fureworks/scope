import { GitSignal, PRInfo } from "../sources/git.js";
import { CalendarEvent, FreeBlock } from "../sources/calendar.js";
import { IssueSignal } from "../sources/issues.js";
import { isItemMuted } from "../store/muted.js";
import { ScoringWeights, DEFAULT_WEIGHTS } from "../store/config.js";

export type Priority = "now" | "today" | "later";
export type AttentionLane = "review" | "merge" | "nudge" | "investigate";

export interface ScoreBreakdown {
  staleness: number;
  blocking: number;
  labels: number;
  mergeReady: number;
  timePressure: number;
  effortMatch: number;
  weightMultiplier: number;
  weightedScore: number;
}

export interface RepoMomentum {
  state: "active" | "quiet" | "stale";
  lastCommitAgeHours: number;
  uncommittedFiles: number;
  openPrs: number;
  staleBranches: number;
}

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
  scoreBreakdown: ScoreBreakdown;
  whySurfaced: string[];
  repoMomentum?: RepoMomentum;
  coveredByOpenPr: boolean;
  blocked: boolean;
  blockedReason?: string;
  freshnessCheckedAt: string;
  attentionLane: AttentionLane;
}

export interface PrioritizedOutput {
  now: ScoredItem[];
  today: ScoredItem[];
  ignored: Array<{ label: string; reason: string }>;
  readonly laterCount: number;
  freeBlocks: FreeBlock[];
  suggestions: string[];
  mode: "ops-radar";
  advisory: true;
  generatedAt: string;
}

interface CandidateItem extends ScoredItem {
  suppressionReason?: string;
}

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

const OWNER_BLOCK_PATTERNS = [
  /needs[- _]?owner/i,
  /owner[- _]?decision/i,
  /\bowner\b/i,
  /needs[- _]?decision/i,
  /\bdecision\b/i,
  /\bapproval\b/i,
  /needs[- _]?pm/i,
  /\bproduct\b/i,
];

const INFRA_BLOCK_PATTERNS = [
  /\binfra\b/i,
  /environment/i,
  /\benv\b/i,
  /tooling/i,
  /deployment/i,
  /\bdeploy\b/i,
  /\bci\b/i,
  /ops/i,
];

function getLabelBoost(labels: string[]): number {
  let maxBoost = 0;
  for (const label of labels) {
    const lower = label.toLowerCase();
    for (const { pattern, boost } of LABEL_BOOSTS) {
      const re = new RegExp(`(^|[^a-z0-9])${pattern}($|[^a-z0-9])`);
      if (re.test(lower) && boost > maxBoost) {
        maxBoost = boost;
      }
    }
  }
  return maxBoost;
}

function repoSlug(repo: string): string {
  const parts = repo.split("/").filter(Boolean);
  return parts[parts.length - 1] || repo;
}

function sameRepo(a: string, b: string): boolean {
  return a === b || repoSlug(a) === repoSlug(b);
}

function buildRepoMomentum(signal?: GitSignal): RepoMomentum | undefined {
  if (!signal) return undefined;
  let state: RepoMomentum["state"] = "quiet";
  if (signal.uncommittedFiles > 0 || signal.lastCommitAge <= 24) {
    state = "active";
  } else if (signal.lastCommitAge > 72 && signal.openPRs.length === 0) {
    state = "stale";
  }

  return {
    state,
    lastCommitAgeHours: Math.round(signal.lastCommitAge * 10) / 10,
    uncommittedFiles: signal.uncommittedFiles,
    openPrs: signal.openPRs.length,
    staleBranches: signal.staleBranches.length,
  };
}

function createBreakdown(): ScoreBreakdown {
  return {
    staleness: 0,
    blocking: 0,
    labels: 0,
    mergeReady: 0,
    timePressure: 0,
    effortMatch: 0,
    weightMultiplier: 1,
    weightedScore: 0,
  };
}

function detectBlocked(labels: string[]): { blocked: boolean; blockedReason?: string } {
  if (labels.some((label) => OWNER_BLOCK_PATTERNS.some((pattern) => pattern.test(label)))) {
    return {
      blocked: true,
      blockedReason: "Waiting on owner decision.",
    };
  }

  if (labels.some((label) => INFRA_BLOCK_PATTERNS.some((pattern) => pattern.test(label)))) {
    return {
      blocked: true,
      blockedReason: "Waiting on environment or tooling.",
    };
  }

  return { blocked: false };
}

function findCoveringPr(issue: IssueSignal, gitSignals: GitSignal[]): PRInfo | undefined {
  const signal = gitSignals.find((candidate) => sameRepo(candidate.repo, issue.repo));
  if (!signal) return undefined;

  const patterns = [
    new RegExp(`(^|\\W)#${issue.number}(\\b|$)`),
    new RegExp(`/issues/${issue.number}(\\b|$)`),
  ];

  return signal.openPRs.find((pr) => {
    const haystack = `${pr.title}\n${pr.body ?? ""}`;
    return patterns.some((pattern) => pattern.test(haystack));
  });
}

function scoreMyPR(pr: PRInfo, repoName: string, repoSignal: GitSignal | undefined, freshnessCheckedAt: string): CandidateItem | null {
  if (!pr.reviewDecision || pr.reviewDecision === "REVIEW_REQUIRED") return null;

  let score = 0;
  let reason = "";
  const details: string[] = [];
  const whySurfaced: string[] = [];
  const scoreBreakdown = createBreakdown();
  let blocked = false;
  let blockedReason: string | undefined;
  let attentionLane: AttentionLane = "investigate";

  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    score = 28;
    scoreBreakdown.blocking += 28;
    reason = "Changes requested on your PR. Respond to reviewer.";
    blocked = true;
    blockedReason = "Changes requested on the PR.";
    details.push("changes requested");
    whySurfaced.push("changes requested");
    attentionLane = "investigate";
  } else if (pr.reviewDecision === "APPROVED") {
    score = 18;
    scoreBreakdown.mergeReady += 18;
    reason = "Your PR is approved. Merge it.";
    details.push("approved, ready to merge");
    whySurfaced.push("approved and ready to merge");
    attentionLane = "merge";
  }

  if (pr.ciStatus === "fail") {
    score += 5;
    scoreBreakdown.blocking += 5;
    blocked = true;
    blockedReason = "CI is failing.";
    details.push("CI failing");
    whySurfaced.push("failing CI");
    attentionLane = "investigate";
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
    scoreBreakdown,
    whySurfaced,
    repoMomentum: buildRepoMomentum(repoSignal),
    coveredByOpenPr: false,
    blocked,
    blockedReason,
    freshnessCheckedAt,
    attentionLane,
  };
}

function scorePR(pr: PRInfo, repoName: string, repoSignal: GitSignal | undefined, freshnessCheckedAt: string): CandidateItem {
  let score = 0;
  const details: string[] = [];
  const whySurfaced: string[] = [];
  const scoreBreakdown = createBreakdown();
  const ageDaysRounded = Math.round(pr.ageDays);
  let blocked = false;
  let blockedReason: string | undefined;
  let attentionLane: AttentionLane = "nudge";

  let agePoints = 0;
  if (pr.ageDays > 2) {
    agePoints = Math.min(30, Math.round(pr.ageDays * 0.6));
    score += agePoints;
    scoreBreakdown.staleness += agePoints;
    details.push(`open ${ageDaysRounded} days`);
    whySurfaced.push(`open ${ageDaysRounded} days`);
  }

  const reviewPoints = pr.reviewRequested ? 15 : 0;
  const ciPoints = pr.ciStatus === "fail" ? 10 : 0;
  const conflictPoints = pr.hasConflicts ? 8 : 0;

  if (pr.reviewRequested) {
    score += reviewPoints;
    scoreBreakdown.blocking += reviewPoints;
    details.push("review requested");
    whySurfaced.push("review requested");
    attentionLane = "review";
  }
  if (pr.ciStatus === "fail") {
    score += ciPoints;
    scoreBreakdown.blocking += ciPoints;
    blocked = true;
    blockedReason = "CI is failing.";
    details.push("CI failing");
    whySurfaced.push("failing CI");
    attentionLane = "investigate";
  }
  if (pr.hasConflicts) {
    score += conflictPoints;
    scoreBreakdown.blocking += conflictPoints;
    blocked = true;
    blockedReason = "Merge conflicts detected.";
    details.push("has conflicts");
    whySurfaced.push("merge conflicts");
    attentionLane = "investigate";
  }

  const labelBoost = getLabelBoost(pr.labels ?? []);
  if (labelBoost > 0) {
    score += labelBoost;
    scoreBreakdown.labels += labelBoost;
    details.push("priority label");
    whySurfaced.push(`priority label: ${(pr.labels ?? []).join(", ")}`);
  }

  const approvedBoost = pr.reviewDecision === "APPROVED" && !pr.hasConflicts ? 20 : 0;
  if (approvedBoost > 0) {
    score += approvedBoost;
    scoreBreakdown.mergeReady += approvedBoost;
    details.push("approved, ready to merge");
    whySurfaced.push("approved and ready to merge");
    attentionLane = "merge";
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
  } else if (ciPoints >= conflictPoints && ciPoints > 0) {
    reason = "CI is failing. Fix or close.";
  } else if (conflictPoints > 0) {
    reason = "Merge conflicts detected. Rebase or close.";
  } else if (approvedBoost > 0) {
    reason = "Approved and ready to merge. Ship it.";
  }

  const priority: Priority = score >= 25 ? "now" : score >= 12 ? "today" : "later";

  const suppressionReason =
    priority === "later"
      ? pr.ageDays <= 2 && !pr.reviewRequested
        ? "Fresh, no one's waiting"
        : pr.ciStatus === "pass"
          ? "On track, CI green"
          : undefined
      : undefined;

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
    scoreBreakdown,
    whySurfaced,
    repoMomentum: buildRepoMomentum(repoSignal),
    coveredByOpenPr: false,
    blocked,
    blockedReason,
    freshnessCheckedAt,
    attentionLane,
  };
}

function scoreRepoWork(signal: GitSignal, freshnessCheckedAt: string): CandidateItem | null {
  if (signal.uncommittedFiles === 0) return null;

  let score = 0;
  const details: string[] = [];
  const whySurfaced: string[] = [];
  const scoreBreakdown = createBreakdown();

  details.push(
    `${signal.uncommittedFiles} uncommitted file${signal.uncommittedFiles > 1 ? "s" : ""}`
  );
  whySurfaced.push(`${signal.uncommittedFiles} uncommitted file${signal.uncommittedFiles > 1 ? "s" : ""}`);

  const days = Math.round(signal.lastCommitAge / 24);
  let reason = "Uncommitted changes detected.";
  if (signal.lastCommitAge > 72) {
    score += 28;
    scoreBreakdown.staleness += 28;
    details.push(`last commit ${days}d ago`);
    whySurfaced.push(`last commit ${days}d ago`);
    reason = `Uncommitted work for ${days} days. Commit or stash.`;
  } else if (signal.lastCommitAge > 24) {
    score += 18;
    scoreBreakdown.staleness += 18;
    details.push(`last commit ${days}d ago`);
    whySurfaced.push(`last commit ${days}d ago`);
    reason = `Uncommitted work for ${days} days. Commit or stash.`;
  } else if (signal.lastCommitAge > 4) {
    const hours = Math.round(signal.lastCommitAge);
    score += 8;
    scoreBreakdown.staleness += 8;
    details.push(`last touched ${hours}h ago`);
    whySurfaced.push(`last touched ${hours}h ago`);
    reason = `Uncommitted work for ${hours} hours. Commit or stash.`;
  } else {
    score += 3;
    scoreBreakdown.staleness += 3;
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
    confidence: "high" as const,
    source: "git",
    suppressionReason:
      priority === "later" ? "Recently touched, nothing stale" : undefined,
    scoreBreakdown,
    whySurfaced,
    repoMomentum: buildRepoMomentum(signal),
    coveredByOpenPr: false,
    blocked: false,
    freshnessCheckedAt,
    attentionLane: "investigate",
  };
}

function scoreCalendarEvent(event: CalendarEvent, freshnessCheckedAt: string): ScoredItem | null {
  if (event.minutesUntilStart < -15) return null;

  let score = 0;
  let reason = "Upcoming calendar event.";
  const whySurfaced: string[] = [];
  const scoreBreakdown = createBreakdown();

  if (event.minutesUntilStart <= 0 && event.minutesUntilStart > -15) {
    score += 30;
    scoreBreakdown.timePressure += 30;
    reason = "Happening now.";
    whySurfaced.push("happening now");
  } else if (event.minutesUntilStart <= 30) {
    score += 28;
    scoreBreakdown.timePressure += 28;
    reason = `Starting in ${event.minutesUntilStart} minutes.`;
    whySurfaced.push(`starts in ${event.minutesUntilStart} minutes`);
  } else if (event.minutesUntilStart <= 60) {
    score += 20;
    scoreBreakdown.timePressure += 20;
    reason = `Starting in ${event.minutesUntilStart} minutes.`;
    whySurfaced.push(`starts in ${event.minutesUntilStart} minutes`);
  } else {
    score += 14;
    scoreBreakdown.timePressure += 14;
    whySurfaced.push(`starts in ${event.minutesUntilStart} minutes`);
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
    confidence: "high" as const,
    source: "calendar",
    scoreBreakdown,
    whySurfaced,
    coveredByOpenPr: false,
    blocked: false,
    freshnessCheckedAt,
    attentionLane: "investigate",
  };
}

function scoreIssue(issue: IssueSignal, gitSignals: GitSignal[], freshnessCheckedAt: string): CandidateItem {
  let score = 0;
  const details: string[] = [];
  const whySurfaced: string[] = [];
  const scoreBreakdown = createBreakdown();
  const ageDaysRounded = Math.round(issue.ageDays);

  let agePoints = 0;
  if (issue.ageDays > 2) {
    agePoints = Math.min(30, Math.round(issue.ageDays * 0.6));
    score += agePoints;
    scoreBreakdown.staleness += agePoints;
    details.push(`open ${ageDaysRounded} days`);
    whySurfaced.push(`open ${ageDaysRounded} days`);
  }

  const labelBoost = getLabelBoost(issue.labels);
  if (labelBoost > 0) {
    score += labelBoost;
    scoreBreakdown.labels += labelBoost;
    details.push("priority label");
    whySurfaced.push(`priority label: ${issue.labels.join(", ")}`);
  }

  const coveringPr = findCoveringPr(issue, gitSignals);
  if (coveringPr) {
    whySurfaced.push(`covered by open PR #${coveringPr.number}`);
  }

  const blockedState = detectBlocked(issue.labels);
  const priority: Priority = score >= 25 ? "now" : score >= 12 ? "today" : "later";
  const labels = issue.labels.length > 0 ? ` [${issue.labels.join(", ")}]` : "";

  let reason = "Issue needs attention.";
  if (agePoints > labelBoost && agePoints > 0) {
    reason = `Open ${ageDaysRounded} days. Getting stale.`;
  } else if (labelBoost > 0) {
    const topLabel = issue.labels.find((l) => getLabelBoost([l]) === labelBoost) || issue.labels[0];
    reason = `Marked ${topLabel}. Needs attention.`;
  }

  if (blockedState.blockedReason) {
    reason = blockedState.blockedReason;
  }

  const issueMissing: string[] = [];
  if (issue.labels.length === 0) issueMissing.push("no labels");
  const issueConfidence: ScoredItem["confidence"] = issueMissing.length > 0 ? "medium" : "high";
  const repoSignal = gitSignals.find((signal) => sameRepo(signal.repo, issue.repo));

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
    scoreBreakdown,
    whySurfaced,
    repoMomentum: buildRepoMomentum(repoSignal),
    coveredByOpenPr: Boolean(coveringPr),
    blocked: blockedState.blocked,
    blockedReason: blockedState.blockedReason,
    freshnessCheckedAt,
    attentionLane: blockedState.blocked ? "investigate" : "nudge",
  };
}

export function prioritize(
  gitSignals: GitSignal[],
  calendarEvents: CalendarEvent[],
  freeBlocks: FreeBlock[],
  issues: IssueSignal[],
  weights: ScoringWeights = DEFAULT_WEIGHTS
): PrioritizedOutput {
  const generatedAt = new Date().toISOString();
  const allItems: CandidateItem[] = [];

  for (const event of calendarEvents) {
    const scored = scoreCalendarEvent(event, generatedAt);
    if (scored) allItems.push(scored);
  }

  for (const signal of gitSignals) {
    const gitItemId = `git:${signal.repo}`;
    const repoItem = isItemMuted(gitItemId) ? null : scoreRepoWork(signal, generatedAt);
    if (repoItem) allItems.push(repoItem);

    for (const pr of signal.openPRs) {
      const prItemId = `pr:${signal.repo}#${pr.number}`;
      if (isItemMuted(prItemId)) continue;
      allItems.push(scorePR(pr, signal.repo, signal, generatedAt));
    }

    for (const pr of signal.myPRs) {
      const prItemId = `mypr:${signal.repo}#${pr.number}`;
      const alreadyScored = signal.openPRs.some((p) => p.number === pr.number);
      if (alreadyScored || isItemMuted(prItemId)) continue;
      const scored = scoreMyPR(pr, signal.repo, signal, generatedAt);
      if (scored) allItems.push(scored);
    }
  }

  for (const issue of issues) {
    const issueItemId = `issue:${issue.repo}#${issue.number}`;
    if (isItemMuted(issueItemId)) continue;
    const scored = scoreIssue(issue, gitSignals, generatedAt);
    if (scored) allItems.push(scored);
  }

  for (const item of allItems) {
    let weightMultiplier = 1;
    if (item.source === "git") {
      weightMultiplier = weights.staleness;
    } else if (item.source === "pr") {
      weightMultiplier = Math.max(weights.staleness, weights.blocking);
    } else if (item.source === "calendar") {
      weightMultiplier = weights.timePressure;
    } else if (item.source === "issue") {
      weightMultiplier = weights.staleness;
    }

    item.scoreBreakdown.weightMultiplier = weightMultiplier;
    item.score = Math.round(item.score * weightMultiplier);
    item.scoreBreakdown.weightedScore = item.score;
    item.priority = item.score >= 25 ? "now" : item.score >= 12 ? "today" : "later";

    if (item.priority === "later" && item.detail?.includes("priority label")) {
      const hasHighPriorityLabel = (item.source === "pr" || item.source === "issue") &&
        item.detail?.match(/\b(P0|critical|blocker|security|compliance)\b/i);
      if (hasHighPriorityLabel) {
        item.priority = "today";
        item.score = Math.max(item.score, 12);
        item.scoreBreakdown.weightedScore = item.score;
      }
    }
  }

  allItems.sort((a, b) => b.score - a.score);

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
    mode: "ops-radar",
    advisory: true,
    generatedAt,
  };
}
