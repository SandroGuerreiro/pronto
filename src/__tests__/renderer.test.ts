import { describe, it, expect, vi, beforeEach } from "vitest";
import { makePr, withChecks, withReviewDecision } from "./fixtures";

// Mutable mock state — use getters so renderer.ts reads current values
const mockState = vi.hoisted(() => ({
  currentAttentionUrls: [] as string[],
  currentResult: null as any,
  showAuthorInCards: false,
  groupByRepository: false,
  favoriteOrgs: new Set<string>(),
  favoriteRepos: new Set<string>(),
  hiddenOrgs: new Set<string>(),
  hiddenRepos: new Set<string>(),
  collapsedAccordions: new Set<string>(),
  pendingUnhideOrgs: new Set<string>(),
  pendingUnhideRepos: new Set<string>(),
  autoWatchedPrUrls: new Set<string>(),
}));

vi.mock("../state", () => ({
  get currentAttentionUrls() { return mockState.currentAttentionUrls; },
  get currentResult() { return mockState.currentResult; },
  get showAuthorInCards() { return mockState.showAuthorInCards; },
  get groupByRepository() { return mockState.groupByRepository; },
  get favoriteOrgs() { return mockState.favoriteOrgs; },
  get favoriteRepos() { return mockState.favoriteRepos; },
  get hiddenOrgs() { return mockState.hiddenOrgs; },
  get hiddenRepos() { return mockState.hiddenRepos; },
  get collapsedAccordions() { return mockState.collapsedAccordions; },
  get pendingUnhideOrgs() { return mockState.pendingUnhideOrgs; },
  get pendingUnhideRepos() { return mockState.pendingUnhideRepos; },
  get autoWatchedPrUrls() { return mockState.autoWatchedPrUrls; },
}));

import {
  getStatus,
  getChecksLabel,
  getReviewStatus,
  filterPrs,
  renderPrCard,
  renderActionButtons,
  renderRepoAccordion,
  renderAccordionContent,
  renderFlatList,
  renderCollapsibleSection,
} from "../renderer";

beforeEach(() => {
  mockState.currentAttentionUrls = [];
  mockState.currentResult = null;
  mockState.showAuthorInCards = false;
  mockState.groupByRepository = false;
  mockState.favoriteOrgs.clear();
  mockState.favoriteRepos.clear();
  mockState.hiddenOrgs.clear();
  mockState.hiddenRepos.clear();
  mockState.collapsedAccordions.clear();
  mockState.pendingUnhideOrgs.clear();
  mockState.pendingUnhideRepos.clear();
});

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

  it("filter=attention keeps only PRs whose URL is in currentAttentionUrls", () => {
    mockState.currentAttentionUrls = [
      "https://github.com/org/repo/pull/2",
      "https://github.com/org/repo/pull/4",
    ];
    const result = filterPrs(prs, "", "attention");
    expect(result).toHaveLength(2);
    expect(result.map((pr) => pr.url)).toEqual([
      "https://github.com/org/repo/pull/2",
      "https://github.com/org/repo/pull/4",
    ]);
  });

  it("filter=attention returns empty when no attention URLs match", () => {
    mockState.currentAttentionUrls = ["https://github.com/org/repo/pull/999"];
    const result = filterPrs(prs, "", "attention");
    expect(result).toHaveLength(0);
  });

  it("filter=attention combined with query narrows further", () => {
    mockState.currentAttentionUrls = [
      "https://github.com/org/repo/pull/1",
      "https://github.com/org/repo/pull/2",
    ];
    const result = filterPrs(prs, "add", "attention");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Add feature");
  });

  it("filter=attention returns empty when currentAttentionUrls is empty", () => {
    mockState.currentAttentionUrls = [];
    const result = filterPrs(prs, "", "attention");
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// renderPrCard
// ---------------------------------------------------------------------------

describe("renderPrCard", () => {
  it("renders title and PR number from URL", () => {
    const pr = makePr({ title: "My feature", url: "https://github.com/org/repo/pull/42" });
    const html = renderPrCard(pr);
    expect(html).toContain("My feature");
    expect(html).toContain("#42");
  });

  it("renders status dot with correct class", () => {
    const pr = makePr({ state: "OPEN" });
    const html = renderPrCard(pr);
    expect(html).toContain('class="pr-status open"');
    expect(html).toContain("●");
  });

  it("renders merged status", () => {
    const pr = makePr({ state: "MERGED", merged: true });
    const html = renderPrCard(pr);
    expect(html).toContain('class="pr-status merged"');
    expect(html).toContain("✓");
  });

  it("renders checks label", () => {
    const pr = withChecks(makePr(), "SUCCESS");
    const html = renderPrCard(pr);
    expect(html).toContain("checks passed");
    expect(html).toContain("checks-pass");
  });

  it("renders review status text", () => {
    const pr = withReviewDecision(makePr(), "APPROVED");
    const html = renderPrCard(pr);
    expect(html).toContain("approved");
  });

  it("renders comment count including unresolved thread comments", () => {
    const pr = makePr({
      comments: { totalCount: 3 },
      reviewThreads: {
        nodes: [
          { isResolved: false, comments: { totalCount: 2 } },
          { isResolved: true, comments: { totalCount: 5 } },
        ],
      },
    });
    const html = renderPrCard(pr);
    // 3 direct comments + 2 unresolved thread comments = 5
    expect(html).toContain("> 5</span>");
  });

  it("renders resolved threads count", () => {
    const pr = makePr({
      reviewThreads: {
        nodes: [
          { isResolved: true, comments: { totalCount: 1 } },
          { isResolved: true, comments: { totalCount: 1 } },
          { isResolved: false, comments: { totalCount: 1 } },
        ],
      },
    });
    const html = renderPrCard(pr);
    expect(html).toContain("▣ 2");
  });

  it("adds attention class when URL is in currentAttentionUrls", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/99" });
    mockState.currentAttentionUrls = ["https://github.com/org/repo/pull/99"];
    const html = renderPrCard(pr);
    expect(html).toContain('class="pr-card attention"');
  });

  it("does not add attention class when URL not in currentAttentionUrls", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/99" });
    mockState.currentAttentionUrls = [];
    const html = renderPrCard(pr);
    expect(html).toContain('class="pr-card"');
    expect(html).not.toContain("attention");
  });

  it("renders draft label for draft PRs", () => {
    const pr = makePr({ isDraft: true });
    const html = renderPrCard(pr);
    expect(html).toContain("draft-label");
    expect(html).toContain("draft");
  });

  it("renders in-queue text with position", () => {
    const pr = makePr({ mergeQueueEntry: { position: 5 } });
    const html = renderPrCard(pr);
    expect(html).toContain("in queue #5");
    expect(html).toContain("in-queue-text");
  });

  it("renders author label when showAuthorInCards is true", () => {
    mockState.showAuthorInCards = true;
    const pr = makePr({ author: { login: "jdoe" } });
    const html = renderPrCard(pr);
    expect(html).toContain("@jdoe");
    expect(html).toContain("pr-author-label");
  });

  it("does not render author label when showAuthorInCards is false", () => {
    mockState.showAuthorInCards = false;
    const pr = makePr({ author: { login: "jdoe" } });
    const html = renderPrCard(pr);
    expect(html).not.toContain("@jdoe");
  });

  it("renders repo label when groupByRepository is false", () => {
    mockState.groupByRepository = false;
    const pr = makePr({ repository: { name: "my-lib", owner: { login: "org" } } });
    const html = renderPrCard(pr);
    expect(html).toContain("pr-repo-label");
    expect(html).toContain("my-lib");
  });

  it("does not render repo label when groupByRepository is true", () => {
    mockState.groupByRepository = true;
    const pr = makePr({ repository: { name: "my-lib", owner: { login: "org" } } });
    const html = renderPrCard(pr);
    expect(html).not.toContain("pr-repo-label");
  });

  it("adds highlight-changed class for review changes", () => {
    const pr = withReviewDecision(makePr({ url: "https://github.com/org/repo/pull/1" }), "APPROVED");
    mockState.currentResult = {
      element_changes: {
        "https://github.com/org/repo/pull/1": {
          became_review_required: false,
          became_changes_requested: false,
          became_approved: true,
          checks_failed: false,
          checks_recovered: false,
          kicked_from_queue: false,
          new_comment: false,
          new_comment_participated: false,
        },
      },
    };
    const html = renderPrCard(pr);
    expect(html).toContain("highlight-changed");
  });

  it("adds highlight-changed class for checks_failed", () => {
    const pr = withChecks(makePr({ url: "https://github.com/org/repo/pull/1" }), "FAILURE");
    mockState.currentResult = {
      element_changes: {
        "https://github.com/org/repo/pull/1": {
          became_review_required: false,
          became_changes_requested: false,
          became_approved: false,
          checks_failed: true,
          checks_recovered: false,
          kicked_from_queue: false,
          new_comment: false,
          new_comment_participated: false,
        },
      },
    };
    const html = renderPrCard(pr);
    expect(html).toContain("highlight-changed");
  });

  it("adds highlight-attention class for new_comment", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1" });
    mockState.currentResult = {
      element_changes: {
        "https://github.com/org/repo/pull/1": {
          became_review_required: false,
          became_changes_requested: false,
          became_approved: false,
          checks_failed: false,
          checks_recovered: false,
          kicked_from_queue: false,
          new_comment: true,
          new_comment_participated: false,
        },
      },
    };
    const html = renderPrCard(pr);
    expect(html).toContain("highlight-attention");
  });

  it("does not add highlight classes when no element_changes", () => {
    const pr = makePr();
    mockState.currentResult = null;
    const html = renderPrCard(pr);
    expect(html).not.toContain("highlight-changed");
    expect(html).not.toContain("highlight-attention");
  });

  it("escapes double quotes in title for data-title attribute", () => {
    const pr = makePr({ title: 'Fix "broken" tests' });
    const html = renderPrCard(pr);
    expect(html).toContain('data-title="Fix &quot;broken&quot; tests"');
  });

  it("handles URL without PR number gracefully", () => {
    const pr = makePr({ url: "https://github.com/org/repo" });
    const html = renderPrCard(pr);
    expect(html).not.toContain("pr-number");
  });
});

// ---------------------------------------------------------------------------
// renderActionButtons
// ---------------------------------------------------------------------------

describe("renderActionButtons", () => {
  it("renders open-gh-btn with correct URL for org", () => {
    const html = renderActionButtons("org", "myorg");
    expect(html).toContain('data-gh-url="https://github.com/myorg"');
    expect(html).toContain("open-gh-btn");
  });

  it("renders open-gh-btn with correct URL for repo", () => {
    const html = renderActionButtons("repo", "myorg/myrepo");
    expect(html).toContain('data-gh-url="https://github.com/myorg/myrepo"');
  });

  it("renders hide-btn active when org is hidden", () => {
    mockState.hiddenOrgs.add("myorg");
    const html = renderActionButtons("org", "myorg");
    expect(html).toContain('hide-btn active');
    expect(html).toContain('title="Show organization"');
  });

  it("renders hide-btn inactive when org is not hidden", () => {
    const html = renderActionButtons("org", "myorg");
    expect(html).toContain('class="hide-btn"');
    expect(html).not.toContain('hide-btn active');
    expect(html).toContain('title="Hide organization"');
  });

  it("renders fav-btn active with filled star when org is favorited", () => {
    mockState.favoriteOrgs.add("myorg");
    const html = renderActionButtons("org", "myorg");
    expect(html).toContain('fav-btn active');
    expect(html).toContain("★");
    expect(html).toContain('title="Unfavorite organization"');
  });

  it("renders fav-btn inactive with empty star when org is not favorited", () => {
    const html = renderActionButtons("org", "myorg");
    expect(html).toContain('class="fav-btn"');
    expect(html).toContain("☆");
    expect(html).toContain('title="Favorite organization"');
  });

  it("renders hide-btn active when repo is hidden", () => {
    mockState.hiddenRepos.add("myorg/myrepo");
    const html = renderActionButtons("repo", "myorg/myrepo");
    expect(html).toContain('hide-btn active');
    expect(html).toContain('title="Show repository"');
  });

  it("renders fav-btn active when repo is favorited", () => {
    mockState.favoriteRepos.add("myorg/myrepo");
    const html = renderActionButtons("repo", "myorg/myrepo");
    expect(html).toContain('fav-btn active');
    expect(html).toContain("★");
  });
});

// ---------------------------------------------------------------------------
// renderRepoAccordion
// ---------------------------------------------------------------------------

describe("renderRepoAccordion", () => {
  it("renders open by default", () => {
    const prs = [makePr()];
    const html = renderRepoAccordion("org", "repo", prs, false);
    expect(html).toContain("<details");
    expect(html).toContain(" open");
    expect(html).toContain("repo-accordion");
  });

  it("renders collapsed when in collapsedAccordions", () => {
    mockState.collapsedAccordions.add("repo:org/repo");
    const prs = [makePr()];
    const html = renderRepoAccordion("org", "repo", prs, false);
    expect(html).not.toMatch(/data-accordion-id="repo:org\/repo"[^>]* open/);
  });

  it("forces open when forceExpand is true even if in collapsedAccordions", () => {
    mockState.collapsedAccordions.add("repo:org/repo");
    const prs = [makePr()];
    const html = renderRepoAccordion("org", "repo", prs, false, true);
    expect(html).toContain(" open");
  });

  it("adds hidden-accordion class when isHidden", () => {
    const prs = [makePr()];
    const html = renderRepoAccordion("org", "repo", prs, true);
    expect(html).toContain("hidden-accordion");
  });

  it("does not render PR cards when isHidden", () => {
    const prs = [makePr({ title: "Should not appear" })];
    const html = renderRepoAccordion("org", "repo", prs, true);
    expect(html).not.toContain("Should not appear");
    expect(html).not.toContain("pr-card");
  });

  it("renders PR cards when not hidden", () => {
    const prs = [makePr({ title: "Visible PR" })];
    const html = renderRepoAccordion("org", "repo", prs, false);
    expect(html).toContain("Visible PR");
    expect(html).toContain("pr-card");
  });

  it("shows correct PR count in accordion header", () => {
    const prs = [makePr(), makePr({ url: "https://github.com/org/repo/pull/2" })];
    const html = renderRepoAccordion("org", "repo", prs, false);
    expect(html).toContain('class="accordion-count">2</span>');
  });

  it("includes repo action buttons", () => {
    const html = renderRepoAccordion("org", "repo", [makePr()], false);
    expect(html).toContain('data-fav-type="repo"');
    expect(html).toContain('data-hide-type="repo"');
    expect(html).toContain('data-fav-key="org/repo"');
  });
});

// ---------------------------------------------------------------------------
// renderAccordionContent
// ---------------------------------------------------------------------------

describe("renderAccordionContent", () => {
  it("returns empty string when no PRs and no hidden orgs/repos", () => {
    expect(renderAccordionContent([])).toBe("");
  });

  it("groups PRs by org and repo", () => {
    const pr1 = makePr({ url: "https://github.com/alpha/lib/pull/1", repository: { name: "lib", owner: { login: "alpha" } } });
    const pr2 = makePr({ url: "https://github.com/beta/app/pull/2", repository: { name: "app", owner: { login: "beta" } } });
    const html = renderAccordionContent([pr1, pr2]);
    expect(html).toContain('accordion-label">alpha</span>');
    expect(html).toContain('accordion-label">beta</span>');
    expect(html).toContain('accordion-label">lib</span>');
    expect(html).toContain('accordion-label">app</span>');
  });

  it("includes hidden orgs even with no PRs", () => {
    mockState.hiddenOrgs.add("hidden-org");
    const html = renderAccordionContent([]);
    expect(html).toContain("hidden-org");
    expect(html).toContain("hidden-accordion");
  });

  it("includes hidden repos even with no PRs in that repo", () => {
    const pr = makePr({ repository: { name: "visible", owner: { login: "org" } } });
    mockState.hiddenRepos.add("org/secret");
    const html = renderAccordionContent([pr]);
    expect(html).toContain('accordion-label">secret</span>');
    expect(html).toContain("hidden-accordion");
  });

  it("includes pendingUnhideOrgs even with no PRs", () => {
    mockState.pendingUnhideOrgs.add("pending-org");
    const html = renderAccordionContent([]);
    expect(html).toContain("pending-org");
    expect(html).not.toContain("hidden-accordion");
  });

  it("includes pendingUnhideRepos within an existing org", () => {
    const pr = makePr({ repository: { name: "main-repo", owner: { login: "org" } } });
    mockState.pendingUnhideRepos.add("org/unhiding-repo");
    const html = renderAccordionContent([pr]);
    expect(html).toContain('accordion-label">unhiding-repo</span>');
  });

  it("includes pendingUnhideRepos in a new org (not from PRs)", () => {
    mockState.pendingUnhideRepos.add("neworg/somerepo");
    const html = renderAccordionContent([]);
    expect(html).toContain("neworg");
    expect(html).toContain('accordion-label">somerepo</span>');
  });

  it("does not render hidden repos/orgs when forceExpand is true", () => {
    mockState.hiddenOrgs.add("hidden-org");
    mockState.hiddenRepos.add("org/secret");
    const html = renderAccordionContent([], true);
    // forceExpand skips hidden orgs/repos rendering
    expect(html).toBe("");
  });

  it("favorites are sorted first via groupPrs", () => {
    const prA = makePr({ url: "https://github.com/alpha/repo/pull/1", repository: { name: "repo", owner: { login: "alpha" } } });
    const prB = makePr({ url: "https://github.com/beta/repo/pull/2", repository: { name: "repo", owner: { login: "beta" } } });
    mockState.favoriteOrgs.add("beta");
    const html = renderAccordionContent([prA, prB]);
    const betaPos = html.indexOf('accordion-label">beta</span>');
    const alphaPos = html.indexOf('accordion-label">alpha</span>');
    expect(betaPos).toBeLessThan(alphaPos);
  });

  it("hidden orgs are sorted last via groupPrs", () => {
    const prA = makePr({ url: "https://github.com/alpha/repo/pull/1", repository: { name: "repo", owner: { login: "alpha" } } });
    const prZ = makePr({ url: "https://github.com/zeta/repo/pull/2", repository: { name: "repo", owner: { login: "zeta" } } });
    mockState.hiddenOrgs.add("alpha");
    const html = renderAccordionContent([prA, prZ]);
    const alphaPos = html.indexOf('accordion-label">alpha</span>');
    const zetaPos = html.indexOf('accordion-label">zeta</span>');
    expect(zetaPos).toBeLessThan(alphaPos);
  });

  it("alphabetical within same rank via groupPrs", () => {
    const prA = makePr({ url: "https://github.com/cherry/repo/pull/1", repository: { name: "repo", owner: { login: "cherry" } } });
    const prB = makePr({ url: "https://github.com/apple/repo/pull/2", repository: { name: "repo", owner: { login: "apple" } } });
    const html = renderAccordionContent([prA, prB]);
    const applePos = html.indexOf('accordion-label">apple</span>');
    const cherryPos = html.indexOf('accordion-label">cherry</span>');
    expect(applePos).toBeLessThan(cherryPos);
  });
});

// ---------------------------------------------------------------------------
// renderFlatList
// ---------------------------------------------------------------------------

describe("renderFlatList", () => {
  it("returns empty string for empty array", () => {
    expect(renderFlatList([])).toBe("");
  });

  it("sorts by createdAt descending", () => {
    const older = makePr({ title: "Older", url: "https://github.com/org/repo/pull/1", createdAt: "2024-01-01T00:00:00Z" });
    const newer = makePr({ title: "Newer", url: "https://github.com/org/repo/pull/2", createdAt: "2024-06-01T00:00:00Z" });
    const html = renderFlatList([older, newer]);
    const newerPos = html.indexOf("Newer");
    const olderPos = html.indexOf("Older");
    expect(newerPos).toBeLessThan(olderPos);
  });

  it("renders all PR cards", () => {
    const pr1 = makePr({ title: "First", url: "https://github.com/org/repo/pull/1" });
    const pr2 = makePr({ title: "Second", url: "https://github.com/org/repo/pull/2" });
    const html = renderFlatList([pr1, pr2]);
    expect(html).toContain("First");
    expect(html).toContain("Second");
    expect(html).toContain("pr-card");
  });
});

// ---------------------------------------------------------------------------
// renderCollapsibleSection
// ---------------------------------------------------------------------------

describe("renderCollapsibleSection", () => {
  it("returns empty string for empty PRs", () => {
    expect(renderCollapsibleSection("sec:owned", "Owned", [])).toBe("");
  });

  it("renders section title", () => {
    const pr = makePr();
    const html = renderCollapsibleSection("sec:owned", "Owned", [pr]);
    expect(html).toContain("Owned");
    expect(html).toContain("section-title");
  });

  it("renders open by default", () => {
    const pr = makePr();
    const html = renderCollapsibleSection("sec:owned", "Owned", [pr]);
    expect(html).toContain(" open");
    expect(html).toContain("section-accordion");
  });

  it("renders collapsed when sectionId is in collapsedAccordions", () => {
    mockState.collapsedAccordions.add("sec:owned");
    const pr = makePr();
    const html = renderCollapsibleSection("sec:owned", "Owned", [pr]);
    expect(html).not.toMatch(/data-accordion-id="sec:owned"[^>]* open/);
  });

  it("uses flat list when groupByRepository is false", () => {
    mockState.groupByRepository = false;
    const pr = makePr();
    const html = renderCollapsibleSection("sec:owned", "Owned", [pr]);
    // Flat list renders pr-card directly, no accordion wrappers
    expect(html).toContain("pr-card");
    expect(html).not.toContain("org-accordion");
  });

  it("uses accordion content when groupByRepository is true", () => {
    mockState.groupByRepository = true;
    const pr = makePr();
    const html = renderCollapsibleSection("sec:owned", "Owned", [pr]);
    expect(html).toContain("org-accordion");
    expect(html).toContain("repo-accordion");
  });

  it("includes data-accordion-id attribute", () => {
    const pr = makePr();
    const html = renderCollapsibleSection("sec:merged", "Merged", [pr]);
    expect(html).toContain('data-accordion-id="sec:merged"');
  });
});
