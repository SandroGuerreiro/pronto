import type { PullRequest, Release } from "../types";

/** Minimal valid PullRequest with all fields set to sensible defaults. */
export function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    title: "Test PR",
    url: "https://github.com/org/repo/pull/1",
    state: "OPEN",
    merged: false,
    isDraft: false,
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

export function makeRelease(overrides: Partial<Release> = {}): Release {
  return {
    tag_name: "v0.7.0",
    name: "Pronto v0.7.0",
    body: "Bug fixes and improvements",
    published_at: "2026-03-11T14:27:26Z",
    html_url: "https://github.com/SandroGuerreiro/pronto/releases/tag/v0.7.0",
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
