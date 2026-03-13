import { describe, it, expect, vi } from "vitest";
import { makePr, withChecks, withReviewDecision } from "./fixtures";

// Mock state module — renderer.ts imports currentAttentionUrls from it
vi.mock("../state", () => ({
  currentAttentionUrls: [] as string[],
  currentResult: null,
  showAuthorInCards: false,
  groupByRepository: false,
  favoriteOrgs: new Set<string>(),
  favoriteRepos: new Set<string>(),
  hiddenOrgs: new Set<string>(),
  hiddenRepos: new Set<string>(),
  collapsedAccordions: new Set<string>(),
  pendingUnhideOrgs: new Set<string>(),
  pendingUnhideRepos: new Set<string>(),
}));

import { getStatus, getChecksLabel, getReviewStatus, filterPrs } from "../renderer";

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------

describe("getStatus", () => {
  it("returns open for open PR", () => {
    const pr = makePr({ state: "OPEN" });
    expect(getStatus(pr)).toEqual({ label: "●", class: "open" });
  });

  it("returns merged for merged PR", () => {
    const pr = makePr({ state: "MERGED", merged: true });
    expect(getStatus(pr)).toEqual({ label: "✓", class: "merged" });
  });

  it("returns closed for unmerged closed PR", () => {
    const pr = makePr({ state: "CLOSED", merged: false });
    expect(getStatus(pr)).toEqual({ label: "✗", class: "closed" });
  });

  it("returns in-queue when mergeQueueEntry present", () => {
    const pr = makePr({ state: "OPEN", mergeQueueEntry: { position: 3 } });
    expect(getStatus(pr)).toEqual({ label: "◎", class: "in-queue" });
  });

  it("in-queue takes priority over open state", () => {
    const pr = makePr({ state: "OPEN", mergeQueueEntry: { position: 1 } });
    expect(getStatus(pr).class).toBe("in-queue");
  });

  it("in-queue takes priority over merged state", () => {
    const pr = makePr({ state: "OPEN", merged: true, mergeQueueEntry: { position: 1 } });
    expect(getStatus(pr).class).toBe("in-queue");
  });
});

// ---------------------------------------------------------------------------
// getChecksLabel
// ---------------------------------------------------------------------------

describe("getChecksLabel", () => {
  it("returns no-checks when no commits", () => {
    const pr = makePr();
    expect(getChecksLabel(pr)).toEqual({ text: "no checks", class: "checks-none" });
  });

  it("returns no-checks when statusCheckRollup is null", () => {
    const pr = { ...makePr(), commits: { nodes: [{ commit: { statusCheckRollup: null } }] } };
    expect(getChecksLabel(pr)).toEqual({ text: "no checks", class: "checks-none" });
  });

  it("returns pass for SUCCESS", () => {
    const pr = withChecks(makePr(), "SUCCESS");
    expect(getChecksLabel(pr)).toEqual({ text: "checks passed", class: "checks-pass" });
  });

  it("returns fail for FAILURE", () => {
    const pr = withChecks(makePr(), "FAILURE");
    expect(getChecksLabel(pr)).toEqual({ text: "checks failed", class: "checks-fail" });
  });

  it("returns fail for ERROR", () => {
    const pr = withChecks(makePr(), "ERROR");
    expect(getChecksLabel(pr)).toEqual({ text: "checks failed", class: "checks-fail" });
  });

  it("returns pending for PENDING", () => {
    const pr = withChecks(makePr(), "PENDING");
    expect(getChecksLabel(pr)).toEqual({ text: "checks running", class: "checks-pending" });
  });

  it("returns pending for EXPECTED", () => {
    const pr = withChecks(makePr(), "EXPECTED");
    expect(getChecksLabel(pr)).toEqual({ text: "checks running", class: "checks-pending" });
  });

  it("lowercases unknown states", () => {
    const pr = withChecks(makePr(), "SOMETHING_NEW");
    expect(getChecksLabel(pr)).toEqual({ text: "something_new", class: "checks-none" });
  });
});

// ---------------------------------------------------------------------------
// getReviewStatus
// ---------------------------------------------------------------------------

describe("getReviewStatus", () => {
  it("returns approved status", () => {
    const pr = withReviewDecision(makePr({ reviews: { totalCount: 2 } }), "APPROVED");
    const result = getReviewStatus(pr);
    expect(result.statusText).toBe("approved");
    expect(result.statusClass).toBe("approved");
    expect(result.reviewText).toBe("☑ 2");
  });

  it("returns changes requested status", () => {
    const pr = withReviewDecision(makePr(), "CHANGES_REQUESTED");
    const result = getReviewStatus(pr);
    expect(result.statusText).toBe("changes requested");
    expect(result.statusClass).toBe("changes-requested");
  });

  it("returns needs reviews status", () => {
    const pr = withReviewDecision(makePr(), "REVIEW_REQUIRED");
    const result = getReviewStatus(pr);
    expect(result.statusText).toBe("needs reviews");
    expect(result.statusClass).toBe("needs-reviews");
  });

  it("returns null statusText when no decision", () => {
    const pr = withReviewDecision(makePr(), null);
    const result = getReviewStatus(pr);
    expect(result.statusText).toBeNull();
    expect(result.statusClass).toBe("");
  });

  it("review count reflects reviews.totalCount", () => {
    const pr = makePr({ reviews: { totalCount: 5 } });
    expect(getReviewStatus(pr).reviewText).toBe("☑ 5");
  });
});

// ---------------------------------------------------------------------------
// filterPrs
// ---------------------------------------------------------------------------

describe("filterPrs", () => {
  const open = makePr({ title: "Fix bug", state: "OPEN", reviewDecision: null });
  const approved = withReviewDecision(
    makePr({ title: "Add feature", url: "https://github.com/org/repo/pull/2", state: "OPEN" }),
    "APPROVED",
  );
  const changesRequested = withReviewDecision(
    makePr({ title: "Refactor", url: "https://github.com/org/repo/pull/3", state: "OPEN" }),
    "CHANGES_REQUESTED",
  );
  const failing = withChecks(
    makePr({ title: "Broken", url: "https://github.com/org/repo/pull/4", state: "OPEN" }),
    "FAILURE",
  );
  const prs = [open, approved, changesRequested, failing];

  it("returns all PRs for filter=all with no query", () => {
    expect(filterPrs(prs, "", "all")).toHaveLength(4);
  });

  it("filters by title query (case-insensitive)", () => {
    const result = filterPrs(prs, "fix", "all");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Fix bug");
  });

  it("filters by repo name", () => {
    const result = filterPrs(prs, "repo", "all");
    expect(result).toHaveLength(4);
  });

  it("filters by owner login", () => {
    const result = filterPrs(prs, "org", "all");
    expect(result).toHaveLength(4);
  });

  it("query returns empty when no match", () => {
    expect(filterPrs(prs, "nonexistent-xyz", "all")).toHaveLength(0);
  });

  it("filter=approved keeps only approved PRs", () => {
    const result = filterPrs(prs, "", "approved");
    expect(result).toHaveLength(1);
    expect(result[0].reviewDecision).toBe("APPROVED");
  });

  it("filter=changes-requested keeps only changes-requested PRs", () => {
    const result = filterPrs(prs, "", "changes-requested");
    expect(result).toHaveLength(1);
    expect(result[0].reviewDecision).toBe("CHANGES_REQUESTED");
  });

  it("filter=needs-review keeps open PRs with no decision or REVIEW_REQUIRED", () => {
    const reviewRequired = withReviewDecision(
      makePr({ url: "https://github.com/org/repo/pull/5", state: "OPEN" }),
      "REVIEW_REQUIRED",
    );
    const result = filterPrs([open, reviewRequired, approved], "", "needs-review");
    expect(result).toHaveLength(2);
  });

  it("filter=failing keeps PRs with FAILURE or ERROR checks", () => {
    const errPr = withChecks(
      makePr({ url: "https://github.com/org/repo/pull/6" }),
      "ERROR",
    );
    const result = filterPrs([...prs, errPr], "", "failing");
    expect(result).toHaveLength(2);
  });

  it("combines filter and query", () => {
    const result = filterPrs(prs, "add", "approved");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Add feature");
  });

  it("returns empty when query matches but filter does not", () => {
    const result = filterPrs(prs, "fix", "approved");
    expect(result).toHaveLength(0);
  });
});
