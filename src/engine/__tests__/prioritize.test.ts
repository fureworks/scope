import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the muted store
vi.mock('../../store/muted.js', () => ({
  isItemMuted: () => false,
}));

import { prioritize, ScoredItem } from '../prioritize.js';
import { GitSignal, PRInfo } from '../../sources/git.js';
import { IssueSignal } from '../../sources/issues.js';
import { DEFAULT_WEIGHTS } from '../../store/config.js';

function makePR(overrides: Partial<PRInfo> = {}): PRInfo {
  return {
    number: 1,
    title: 'Test PR',
    url: 'https://github.com/test/repo/pull/1',
    ageDays: 5,
    reviewRequested: false,
    reviewDecision: '',
    ciStatus: 'unknown',
    hasConflicts: false,
    labels: [],
    ...overrides,
  };
}

function makeGitSignal(repo: string, prs: PRInfo[]): GitSignal {
  return {
    repo,
    branch: 'main',
    uncommittedFiles: 0,
    lastCommitAge: 1,
    staleBranches: [],
    openPRs: prs,
  };
}

function makeIssue(overrides: Partial<IssueSignal> = {}): IssueSignal {
  return {
    number: 1,
    title: 'Test Issue',
    url: 'https://github.com/test/repo/issues/1',
    repo: 'test/repo',
    ageDays: 5,
    labels: [],
    ...overrides,
  };
}

describe('prioritize', () => {
  describe('graduated staleness scoring', () => {
    it('should score a 51-day PR higher than a 15-day PR', () => {
      const old = makePR({ number: 1, ageDays: 51 });
      const newer = makePR({ number: 2, ageDays: 15 });

      const result = prioritize(
        [makeGitSignal('repo', [old, newer])],
        [], [], [], DEFAULT_WEIGHTS
      );

      // Items may be in now, today, or ignored — collect all scored items
      const allItems = [...result.now, ...result.today];
      const oldItem = allItems.find(i => i.label.includes('#1'));
      const newerItem = allItems.find(i => i.label.includes('#2'));

      // At least the older one should surface
      expect(oldItem).toBeDefined();
      // 51 * 0.6 = 30.6 → 31 (capped at 30), 15 * 0.6 = 9
      expect(oldItem!.score).toBeGreaterThan(9);
      // Newer may be in ignored, but its raw score should be lower
      // Score: 51-day = 30, 15-day = 9 → differentiated
      expect(oldItem!.score).toBeGreaterThanOrEqual(25); // "now" tier
    });

    it('should score a 30-day PR higher than a 16-day PR', () => {
      const thirtyDay = makePR({ number: 1, ageDays: 30 });
      const sixteenDay = makePR({ number: 2, ageDays: 16 });

      const result = prioritize(
        [makeGitSignal('repo', [thirtyDay, sixteenDay])],
        [], [], [], DEFAULT_WEIGHTS
      );

      // 30 * 0.6 = 18 (today), 16 * 0.6 = 9.6 → 10 (later)
      const allItems = [...result.now, ...result.today];
      const item30 = allItems.find(i => i.label.includes('#1'));
      
      expect(item30).toBeDefined();
      expect(item30!.score).toBe(18); // 30 * 0.6 = 18
    });
  });

  describe('label-based scoring', () => {
    it('should score a P0-labeled PR higher than an unlabeled PR', () => {
      const p0 = makePR({ number: 1, ageDays: 10, labels: ['P0-critical'] });
      const plain = makePR({ number: 2, ageDays: 10, labels: [] });

      const result = prioritize(
        [makeGitSignal('repo', [p0, plain])],
        [], [], [], DEFAULT_WEIGHTS
      );

      // P0 score: 10*0.6=6 + 15(P0 boost) = 21 (today)
      // Plain score: 10*0.6=6 (later)
      const allItems = [...result.now, ...result.today];
      const p0Item = allItems.find(i => i.label.includes('#1'));

      expect(p0Item).toBeDefined();
      expect(p0Item!.score).toBe(21); // 6 + 15
    });

    it('should boost compliance-labeled items', () => {
      const compliance = makePR({ number: 1, ageDays: 10, labels: ['compliance'] });
      const plain = makePR({ number: 2, ageDays: 10, labels: [] });

      const result = prioritize(
        [makeGitSignal('repo', [compliance, plain])],
        [], [], [], DEFAULT_WEIGHTS
      );

      // Compliance score: 6 + 12 = 18 (today)
      // Plain score: 6 (later)
      const allItems = [...result.now, ...result.today];
      const compItem = allItems.find(i => i.label.includes('#1'));

      expect(compItem).toBeDefined();
      expect(compItem!.score).toBe(18); // 6 + 12
    });
  });

  describe('confidence notes', () => {
    it('should NOT say "no reviewer assigned" when reviewDecision exists', () => {
      const pr = makePR({
        number: 1,
        ageDays: 30, // high enough to surface in today
        reviewRequested: false,
        reviewDecision: 'CHANGES_REQUESTED',
      });

      const result = prioritize(
        [makeGitSignal('repo', [pr])],
        [], [], [], DEFAULT_WEIGHTS
      );

      const allItems = [...result.now, ...result.today];
      const item = allItems.find(i => i.label.includes('#1'));
      expect(item).toBeDefined();
      // With reviewDecision set, should not flag "no reviewer assigned"
      if (item?.confidenceNote) {
        expect(item.confidenceNote).not.toContain('no reviewer assigned');
      }
    });
  });

  describe('issue scoring', () => {
    it('should include issues in output', () => {
      const issue = makeIssue({ number: 42, ageDays: 20 });

      const result = prioritize(
        [], [], [], [issue], DEFAULT_WEIGHTS
      );

      const allItems = [...result.now, ...result.today];
      expect(allItems.some(i => i.source === 'issue')).toBe(true);
    });
  });
});
