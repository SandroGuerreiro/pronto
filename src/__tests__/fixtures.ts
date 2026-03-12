import type { PullRequest } from "../types";

/** Minimal valid PullRequest with all fields set to sensible defaults. */
export function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    title: "Test PR",
    url: "https://github.com/org/repo/pull/1",
    state: "OPEN",
    merged: false,
    createdAt: "2024-01-01T00:00:00Z",
    repository: { name: "repo", owner: { login: "org" } },
    mergeQueueEntry: null,
    mergeStateStatus: null,
    reviewDecision: null,
    reviews: { totalCount: 0 },
    comments: { totalCount: 0 },
    reviewThreads: { nodes: [] },
    commits: { nodes: [] },
    author: { login: "author" },
    ...overrides,
  };
}

export function withChecks(pr: PullRequest, state: string): PullRequest {
  return {
    ...pr,
    commits: { nodes: [{ commit: { statusCheckRollup: { state } } }] },
  };
}

export function withReviewDecision(pr: PullRequest, decision: string | null): PullRequest {
  return { ...pr, reviewDecision: decision };
}
