import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";
import type { GitSignal, PRInfo } from "../sources/git.js";
import type { IssueSignal } from "../sources/issues.js";
import type { ScoredItem } from "./prioritize.js";

const execFileAsync = promisify(execFile);

export type ItemOutcome =
  | "shipped"
  | "covered_by_open_pr"
  | "triaged_off_now"
  | "waiting_owner_decision"
  | "waiting_infra";

export type BlockedByType = "owner" | "infra";

export interface OutcomeTrackedItem extends ScoredItem {
  outcome?: ItemOutcome;
  outcomeReason?: string;
  coveredByPrNumber?: number;
  blockedByType?: BlockedByType;
  blockedByName?: string;
  freshnessCheckedAt?: string;
}

export interface SnapshotComparison {
  shipped: OutcomeTrackedItem[];
  coveredByOpenPr: OutcomeTrackedItem[];
  triagedOffNow: OutcomeTrackedItem[];
  waitingOwnerDecision: OutcomeTrackedItem[];
  waitingInfra: OutcomeTrackedItem[];
  newItems: OutcomeTrackedItem[];
  persisted: OutcomeTrackedItem[];
  snapshotTime: string;
  freshnessCheckedAt: string;
}

export interface CompareSnapshotOptions {
  snapshotItems: OutcomeTrackedItem[];
  snapshotTime: string;
  currentItems: ScoredItem[];
  gitSignals: GitSignal[];
  currentIssues: IssueSignal[];
  repoPaths: string[];
  lookups?: OutcomeLookups;
  freshnessCheckedAt?: string;
}

interface RepoNumberRef {
  repo: string;
  number: number;
}

interface IssueState {
  state: string;
  stateReason?: string | null;
  labels: string[];
  assignees: string[];
  closedAt?: string | null;
}

interface PrState {
  state: string;
  mergedAt?: string | null;
  labels: string[];
  title?: string;
  body?: string | null;
}

export interface OutcomeLookups {
  getIssueState?: (ref: RepoNumberRef) => Promise<IssueState | null>;
  getPrState?: (ref: RepoNumberRef) => Promise<PrState | null>;
  findCoveringPr?: (ref: RepoNumberRef) => Promise<number | null>;
}

const OWNER_PATTERNS = [
  /needs[- _]?owner/i,
  /owner[- _]?decision/i,
  /\bowner\b/i,
  /needs[- _]?decision/i,
  /\bdecision\b/i,
  /\bapproval\b/i,
  /needs[- _]?pm/i,
  /\bproduct\b/i,
  /\bpm\b/i,
];

const INFRA_PATTERNS = [
  /\binfra\b/i,
  /environment/i,
  /\benv\b/i,
  /tooling/i,
  /deployment/i,
  /\bdeploy\b/i,
  /\bci\b/i,
  /ops/i,
];

function itemKey(item: ScoredItem): string {
  return item.id || `${item.source}|${item.label}`;
}

function repoSlug(repo: string): string {
  return basename(repo);
}

function sameRepo(a: string, b: string): boolean {
  return a === b || repoSlug(a) === repoSlug(b);
}

function stampFreshness(item: ScoredItem, freshnessCheckedAt: string): OutcomeTrackedItem {
  const existing = item as Partial<OutcomeTrackedItem>;
  return {
    ...item,
    freshnessCheckedAt: existing.freshnessCheckedAt ?? freshnessCheckedAt,
    outcome: existing.outcome,
    outcomeReason: existing.outcomeReason,
    coveredByPrNumber: existing.coveredByPrNumber,
    blockedByType: existing.blockedByType,
    blockedByName: existing.blockedByName,
  };
}

function parseRepoNumberRef(item: ScoredItem): RepoNumberRef | null {
  const match = item.id.match(/^[a-z]+:(.+)#(\d+)$/i);
  if (!match) return null;
  return {
    repo: match[1],
    number: Number.parseInt(match[2], 10),
  };
}

function parseBlockedName(labels: string[]): string | undefined {
  for (const label of labels) {
    const match = label.match(/(?:owner|needs[- _]?owner|product|pm|infra|environment|env|tooling)[:/ ]+(.+)/i);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function detectWaitingFromLabels(labels: string[]): {
  outcome: ItemOutcome;
  outcomeReason: string;
  blockedByType: BlockedByType;
  blockedByName?: string;
} | null {
  if (labels.some((label) => OWNER_PATTERNS.some((pattern) => pattern.test(label)))) {
    return {
      outcome: "waiting_owner_decision",
      outcomeReason: "Waiting on owner decision before it can move.",
      blockedByType: "owner",
      blockedByName: parseBlockedName(labels),
    };
  }

  if (labels.some((label) => INFRA_PATTERNS.some((pattern) => pattern.test(label)))) {
    return {
      outcome: "waiting_infra",
      outcomeReason: "Waiting on environment or tooling before it can move.",
      blockedByType: "infra",
      blockedByName: parseBlockedName(labels),
    };
  }

  return null;
}

async function runGhJson<T>(args: string[], cwd?: string): Promise<T | null> {
  try {
    const { stdout } = await execFileAsync("gh", args, {
      cwd,
      encoding: "utf-8",
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    return JSON.parse(stdout) as T;
  } catch {
    return null;
  }
}

function resolveRepoPath(repo: string, repoPaths: Map<string, string>): string | undefined {
  return repoPaths.get(repo) ?? repoPaths.get(repoSlug(repo));
}

function repoScopedArgs(baseArgs: string[], repo: string, repoPaths: Map<string, string>): {
  args: string[];
  cwd?: string;
} {
  const cwd = resolveRepoPath(repo, repoPaths);
  if (cwd) {
    return { args: baseArgs, cwd };
  }

  if (repo.includes("/")) {
    return { args: [...baseArgs, "-R", repo] };
  }

  return { args: baseArgs };
}

function defaultLookups(repoPaths: string[]): OutcomeLookups {
  const repoPathMap = new Map<string, string>(
    repoPaths.flatMap((repoPath) => {
      const slug = basename(repoPath);
      return [[slug, repoPath]];
    })
  );

  return {
    async getIssueState(ref) {
      const target = repoScopedArgs(
        ["issue", "view", String(ref.number), "--json", "state,stateReason,labels,assignees,closedAt"],
        ref.repo,
        repoPathMap
      );
      const result = await runGhJson<{
        state: string;
        stateReason?: string | null;
        labels?: Array<{ name?: string }>;
        assignees?: Array<{ login?: string }>;
        closedAt?: string | null;
      }>(target.args, target.cwd);
      if (!result) return null;
      return {
        state: result.state,
        stateReason: result.stateReason ?? null,
        labels: (result.labels ?? []).map((label) => label.name || "").filter(Boolean),
        assignees: (result.assignees ?? []).map((assignee) => assignee.login || "").filter(Boolean),
        closedAt: result.closedAt ?? null,
      } satisfies IssueState;
    },
    async getPrState(ref) {
      const target = repoScopedArgs(
        ["pr", "view", String(ref.number), "--json", "state,mergedAt,labels,title,body"],
        ref.repo,
        repoPathMap
      );
      const result = await runGhJson<{
        state: string;
        mergedAt?: string | null;
        title?: string;
        body?: string | null;
        labels?: Array<{ name?: string }>;
      }>(target.args, target.cwd);
      if (!result) return null;
      return {
        state: result.state,
        mergedAt: result.mergedAt ?? null,
        title: result.title,
        body: result.body ?? null,
        labels: (result.labels ?? []).map((label) => label.name || "").filter(Boolean),
      } satisfies PrState;
    },
    async findCoveringPr(ref) {
      const target = repoScopedArgs(
        ["pr", "list", "--state", "open", "--json", "number,title,body", "--limit", "50"],
        ref.repo,
        repoPathMap
      );
      const result = await runGhJson<Array<{ number: number; title?: string; body?: string | null }>>(
        target.args,
        target.cwd
      );
      if (!result) return null;

      const issuePatterns = [
        new RegExp(`(^|\\W)#${ref.number}(\\b|$)`),
        new RegExp(`/issues/${ref.number}(\\b|$)`),
      ];

      const covering = result.find((pr) => {
        const haystack = `${pr.title ?? ""}\n${pr.body ?? ""}`;
        return issuePatterns.some((pattern) => pattern.test(haystack));
      });

      return covering?.number ?? null;
    },
  };
}

function liveIssueMatch(ref: RepoNumberRef, currentIssues: IssueSignal[]): IssueSignal | undefined {
  return currentIssues.find((issue) => sameRepo(issue.repo, ref.repo) && issue.number === ref.number);
}

function livePrMatch(ref: RepoNumberRef, gitSignals: GitSignal[]): PRInfo | undefined {
  for (const signal of gitSignals) {
    if (!sameRepo(signal.repo, ref.repo)) continue;
    const match = [...signal.openPRs, ...signal.myPRs].find((pr) => pr.number === ref.number);
    if (match) return match;
  }
  return undefined;
}

function withOutcome(
  item: OutcomeTrackedItem,
  outcome: ItemOutcome,
  outcomeReason: string,
  extras: Partial<OutcomeTrackedItem> = {}
): OutcomeTrackedItem {
  return {
    ...item,
    outcome,
    outcomeReason,
    ...extras,
  };
}

function classifyByLabels(item: OutcomeTrackedItem, labels: string[]): OutcomeTrackedItem | null {
  const waiting = detectWaitingFromLabels(labels);
  if (!waiting) return null;
  return withOutcome(item, waiting.outcome, waiting.outcomeReason, {
    blockedByType: waiting.blockedByType,
    blockedByName: waiting.blockedByName,
  });
}

async function classifyMissingItem(
  item: OutcomeTrackedItem,
  currentIssues: IssueSignal[],
  gitSignals: GitSignal[],
  lookups: OutcomeLookups
): Promise<OutcomeTrackedItem> {
  if (item.source === "git") {
    return withOutcome(item, "triaged_off_now", "No longer has uncommitted work or no longer ranks in the active board.");
  }

  if (item.source === "calendar") {
    return withOutcome(item, "triaged_off_now", "No longer sits in the active time window.");
  }

  const ref = parseRepoNumberRef(item);
  if (!ref) {
    return withOutcome(item, "triaged_off_now", "No longer surfaced in the active board.");
  }

  if (item.source === "issue") {
    const currentIssue = liveIssueMatch(ref, currentIssues);
    if (currentIssue) {
      const waitingCurrent = classifyByLabels(item, currentIssue.labels);
      if (waitingCurrent) return waitingCurrent;
      return withOutcome(item, "triaged_off_now", "Still open, but no longer selected into the current priority board.");
    }

    const coveringPrNumber = await lookups.findCoveringPr?.(ref);
    if (coveringPrNumber) {
      return withOutcome(item, "covered_by_open_pr", `Covered by open PR #${coveringPrNumber}.`, {
        coveredByPrNumber: coveringPrNumber,
      });
    }

    const issueState = await lookups.getIssueState?.(ref);
    if (issueState) {
      const waitingState = classifyByLabels(item, issueState.labels);
      if (issueState.state === "OPEN") {
        if (waitingState) {
          if (issueState.assignees[0]) {
            return {
              ...waitingState,
              blockedByName: waitingState.blockedByName ?? issueState.assignees[0],
            };
          }
          return waitingState;
        }

        return withOutcome(item, "triaged_off_now", "Still open, but not currently selected into the active board.");
      }

      if ((issueState.stateReason ?? "").toUpperCase() === "COMPLETED") {
        return withOutcome(item, "shipped", "Closed as completed.");
      }

      if ((issueState.stateReason ?? "").toUpperCase() === "NOT_PLANNED") {
        return withOutcome(item, "triaged_off_now", "Closed as not planned.");
      }

      return withOutcome(item, "shipped", "Issue was closed since the snapshot.");
    }
  }

  if (item.source === "pr") {
    const currentPr = livePrMatch(ref, gitSignals);
    if (currentPr) {
      const waitingCurrent = classifyByLabels(item, currentPr.labels ?? []);
      if (waitingCurrent) return waitingCurrent;
      return withOutcome(item, "triaged_off_now", "Still open, but no longer selected into the current priority board.");
    }

    const prState = await lookups.getPrState?.(ref);
    if (prState) {
      if (prState.mergedAt || prState.state.toUpperCase() === "MERGED") {
        return withOutcome(item, "shipped", "Merged since the snapshot.");
      }

      if (prState.state.toUpperCase() === "OPEN") {
        const waitingState = classifyByLabels(item, prState.labels);
        if (waitingState) return waitingState;
        return withOutcome(item, "triaged_off_now", "Still open, but not currently selected into the active board.");
      }

      return withOutcome(item, "triaged_off_now", "Closed without merging since the snapshot.");
    }
  }

  return withOutcome(item, "triaged_off_now", "No longer surfaced in the active board.");
}

export async function compareSnapshotOutcomes(options: CompareSnapshotOptions): Promise<SnapshotComparison> {
  const freshnessCheckedAt = options.freshnessCheckedAt ?? new Date().toISOString();
  const lookups = {
    ...defaultLookups(options.repoPaths),
    ...options.lookups,
  } satisfies OutcomeLookups;

  const currentStamped = options.currentItems.map((item) => stampFreshness(item, freshnessCheckedAt));
  const snapshotStamped = options.snapshotItems.map((item) => stampFreshness(item, item.freshnessCheckedAt ?? options.snapshotTime));

  const snapshotKeys = new Set(snapshotStamped.map(itemKey));
  const currentKeys = new Set(currentStamped.map(itemKey));

  const persisted = currentStamped.filter((item) => snapshotKeys.has(itemKey(item)));
  const newItems = currentStamped.filter((item) => !snapshotKeys.has(itemKey(item)));
  const missingItems = snapshotStamped
    .filter((item) => !currentKeys.has(itemKey(item)))
    .map((item) => ({
      ...item,
      freshnessCheckedAt,
    }));
  const classifiedMissing = await Promise.all(
    missingItems.map((item) => classifyMissingItem(item, options.currentIssues, options.gitSignals, lookups))
  );

  return {
    shipped: classifiedMissing.filter((item) => item.outcome === "shipped"),
    coveredByOpenPr: classifiedMissing.filter((item) => item.outcome === "covered_by_open_pr"),
    triagedOffNow: classifiedMissing.filter((item) => item.outcome === "triaged_off_now"),
    waitingOwnerDecision: classifiedMissing.filter((item) => item.outcome === "waiting_owner_decision"),
    waitingInfra: classifiedMissing.filter((item) => item.outcome === "waiting_infra"),
    newItems,
    persisted,
    snapshotTime: options.snapshotTime,
    freshnessCheckedAt,
  };
}
