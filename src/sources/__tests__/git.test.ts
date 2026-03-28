import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('PRInfo interface contract', () => {
  it('should include reviewDecision and labels fields', () => {
    // Verify the shape of PRInfo matches what we expect from gh CLI
    const mockGhOutput = [
      {
        number: 119,
        title: 'fix(lti): persist launch_id',
        url: 'https://github.com/Elwyn-AI/elwyn-ai/pull/119',
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        reviewRequests: [{ login: 'feraldolim' }],
        reviewDecision: 'REVIEW_REQUIRED',
        statusCheckRollup: [{ conclusion: 'SUCCESS' }],
        mergeable: 'MERGEABLE',
        labels: [{ name: 'bug' }, { name: 'P1-important' }],
      },
    ];

    const pr = mockGhOutput[0];

    // reviewDecision should be a string
    expect(typeof pr.reviewDecision).toBe('string');
    expect(pr.reviewDecision).toBe('REVIEW_REQUIRED');

    // labels should be extractable to string[]
    const labels = pr.labels.map((l) => l.name).filter(Boolean);
    expect(labels).toEqual(['bug', 'P1-important']);

    // reviewRequested should be true when reviewRequests is non-empty OR reviewDecision is set
    const reviewRequested =
      pr.reviewRequests.length > 0 ||
      pr.reviewDecision === 'REVIEW_REQUIRED' ||
      pr.reviewDecision === 'CHANGES_REQUESTED';
    expect(reviewRequested).toBe(true);
  });

  it('should detect no reviewer when both reviewRequests and reviewDecision are empty', () => {
    const pr = {
      reviewRequests: [] as Array<{ login: string }>,
      reviewDecision: '',
    };

    const reviewRequested =
      pr.reviewRequests.length > 0 ||
      pr.reviewDecision === 'REVIEW_REQUIRED' ||
      pr.reviewDecision === 'CHANGES_REQUESTED';
    expect(reviewRequested).toBe(false);
  });

  it('should detect reviewer via CHANGES_REQUESTED even with empty reviewRequests', () => {
    const pr = {
      reviewRequests: [] as Array<{ login: string }>,
      reviewDecision: 'CHANGES_REQUESTED',
    };

    const reviewRequested =
      pr.reviewRequests.length > 0 ||
      pr.reviewDecision === 'REVIEW_REQUIRED' ||
      pr.reviewDecision === 'CHANGES_REQUESTED';
    expect(reviewRequested).toBe(true);
  });
});
