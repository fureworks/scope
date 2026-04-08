import { describe, expect, it } from "vitest";
import type { ScoredItem } from "../prioritize.js";
import { compareSnapshotOutcomes } from "../outcomes.js";

function makeIssueItem(id: string, label = "Issue #12 on scope"): ScoredItem {
  return {
    id,
    priority: "today",
    score: 12,
    emoji: "📋",
    label,
    detail: "Test issue",
    reason: "Needs attention.",
    confidence: "high",
    source: "issue",
  };
}

function makePrItem(id: string, label = "PR #7 on scope"): ScoredItem {
  return {
    id,
    priority: "today",
    score: 14,
    emoji: "🟡",
    label,
    detail: "Test pr",
    reason: "Needs attention.",
    confidence: "high",
    source: "pr",
  };
}

describe("compareSnapshotOutcomes", () => {
  it("classifies issues covered by an open PR", async () => {
    const comparison = await compareSnapshotOutcomes({
      snapshotItems: [makeIssueItem("issue:scope#12")],
      snapshotTime: "2026-04-08T00:00:00.000Z",
      currentItems: [],
      gitSignals: [],
      currentIssues: [],
      repoPaths: [],
      lookups: {
        findCoveringPr: async () => 88,
      },
      freshnessCheckedAt: "2026-04-08T10:00:00.000Z",
    });

    expect(comparison.coveredByOpenPr).toHaveLength(1);
    expect(comparison.coveredByOpenPr[0].coveredByPrNumber).toBe(88);
    expect(comparison.coveredByOpenPr[0].outcome).toBe("covered_by_open_pr");
    expect(comparison.coveredByOpenPr[0].freshnessCheckedAt).toBe("2026-04-08T10:00:00.000Z");
  });

  it("classifies completed issues as shipped", async () => {
    const comparison = await compareSnapshotOutcomes({
      snapshotItems: [makeIssueItem("issue:scope#12")],
      snapshotTime: "2026-04-08T00:00:00.000Z",
      currentItems: [],
      gitSignals: [],
      currentIssues: [],
      repoPaths: [],
      lookups: {
        findCoveringPr: async () => null,
        getIssueState: async () => ({
          state: "CLOSED",
          stateReason: "COMPLETED",
          labels: [],
          assignees: [],
          closedAt: "2026-04-08T09:00:00.000Z",
        }),
      },
    });

    expect(comparison.shipped).toHaveLength(1);
    expect(comparison.shipped[0].outcome).toBe("shipped");
  });

  it("classifies open owner-blocked issues explicitly", async () => {
    const comparison = await compareSnapshotOutcomes({
      snapshotItems: [makeIssueItem("issue:scope#12")],
      snapshotTime: "2026-04-08T00:00:00.000Z",
      currentItems: [],
      gitSignals: [],
      currentIssues: [],
      repoPaths: [],
      lookups: {
        findCoveringPr: async () => null,
        getIssueState: async () => ({
          state: "OPEN",
          labels: ["needs-owner: Aldo"],
          assignees: ["aldo"],
        }),
      },
    });

    expect(comparison.waitingOwnerDecision).toHaveLength(1);
    expect(comparison.waitingOwnerDecision[0].blockedByType).toBe("owner");
    expect(comparison.waitingOwnerDecision[0].blockedByName).toBe("Aldo");
  });

  it("classifies open infra-blocked PRs explicitly", async () => {
    const comparison = await compareSnapshotOutcomes({
      snapshotItems: [makePrItem("pr:scope#7")],
      snapshotTime: "2026-04-08T00:00:00.000Z",
      currentItems: [],
      gitSignals: [],
      currentIssues: [],
      repoPaths: [],
      lookups: {
        getPrState: async () => ({
          state: "OPEN",
          mergedAt: null,
          labels: ["infra"],
        }),
      },
    });

    expect(comparison.waitingInfra).toHaveLength(1);
    expect(comparison.waitingInfra[0].outcome).toBe("waiting_infra");
  });
});
