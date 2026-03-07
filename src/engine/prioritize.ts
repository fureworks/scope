import { GitSignal, PRInfo } from "../sources/git.js";
import { CalendarEvent, FreeBlock } from "../sources/calendar.js";

export type Priority = "now" | "today" | "later";

export interface ScoredItem {
  priority: Priority;
  score: number;
  emoji: string;
  label: string;
  detail: string;
  source: "git" | "calendar" | "pr";
}

export interface PrioritizedOutput {
  now: ScoredItem[];
  today: ScoredItem[];
  laterCount: number;
  freeBlocks: FreeBlock[];
  suggestions: string[];
}

function scorePR(pr: PRInfo, repoName: string): ScoredItem {
  let score = 0;
  const details: string[] = [];

  // Staleness
  if (pr.ageDays > 14) {
    score += 9; // 2+ weeks = critical
    details.push(`open ${Math.round(pr.ageDays)} days`);
  } else if (pr.ageDays > 5) {
    score += 7;
    details.push(`open ${Math.round(pr.ageDays)} days`);
  } else if (pr.ageDays > 2) {
    score += 4;
    details.push(`open ${Math.round(pr.ageDays)} days`);
  }

  // Blocking potential
  if (pr.reviewRequested) {
    score += 8;
    details.push("review requested");
  }
  if (pr.ciStatus === "fail") {
    score += 5;
    details.push("CI failing");
  }
  if (pr.hasConflicts) {
    score += 4;
    details.push("has conflicts");
  }

  const priority: Priority = score >= 8 ? "now" : score >= 4 ? "today" : "later";

  return {
    priority,
    score,
    emoji: priority === "now" ? "🔴" : "🟡",
    label: `PR #${pr.number} on ${repoName}`,
    detail: `${pr.title} — ${details.join(", ")}`,
    source: "pr",
  };
}

function scoreRepoWork(signal: GitSignal): ScoredItem | null {
  if (signal.uncommittedFiles === 0) return null;

  let score = 0;
  const details: string[] = [];

  details.push(
    `${signal.uncommittedFiles} uncommitted file${signal.uncommittedFiles > 1 ? "s" : ""}`
  );

  // Staleness of uncommitted work
  const days = Math.round(signal.lastCommitAge / 24);
  if (signal.lastCommitAge > 72) {
    score += 9; // 3+ days uncommitted = NOW
    details.push(`last commit ${days}d ago`);
  } else if (signal.lastCommitAge > 24) {
    score += 6;
    details.push(`last commit ${days}d ago`);
  } else if (signal.lastCommitAge > 4) {
    score += 3;
    details.push(`last touched ${Math.round(signal.lastCommitAge)}h ago`);
  } else {
    score += 1;
  }

  if (score < 2) return null; // Don't surface fresh uncommitted work

  const priority: Priority = score >= 8 ? "now" : score >= 4 ? "today" : "later";

  return {
    priority,
    score,
    emoji: priority === "now" ? "🔴" : "🟡",
    label: `${signal.repo}`,
    detail: details.join(", "),
    source: "git",
  };
}

function scoreCalendarEvent(event: CalendarEvent): ScoredItem | null {
  // Only surface upcoming events (not past ones)
  if (event.minutesUntilStart < -15) return null;

  let score = 0;

  if (event.minutesUntilStart <= 60 && event.minutesUntilStart > 0) {
    score += 10;
  } else if (event.minutesUntilStart <= 0 && event.minutesUntilStart > -15) {
    score += 10; // Happening now
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
    source: "calendar",
  };
}

export function prioritize(
  gitSignals: GitSignal[],
  calendarEvents: CalendarEvent[],
  freeBlocks: FreeBlock[]
): PrioritizedOutput {
  const allItems: ScoredItem[] = [];

  // Score calendar events
  for (const event of calendarEvents) {
    const scored = scoreCalendarEvent(event);
    if (scored) allItems.push(scored);
  }

  // Score git repos
  for (const signal of gitSignals) {
    // Score uncommitted work
    const repoItem = scoreRepoWork(signal);
    if (repoItem) allItems.push(repoItem);

    // Score PRs
    for (const pr of signal.openPRs) {
      allItems.push(scorePR(pr, signal.repo));
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
  const laterCount =
    allLater.length +
    Math.max(0, todayOverflow.length + allToday.length - 5);

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

  return { now, today, laterCount, freeBlocks, suggestions };
}
