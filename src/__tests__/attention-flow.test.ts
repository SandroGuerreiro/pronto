/**
 * Integration tests for the "needs attention" system.
 *
 * Tests the full attention data flow across modules:
 *   FetchResult.attention_urls → state → PR card rendering → badge counts → dismiss flow
 *
 * These tests verify that if anything in the attention pipeline breaks,
 * we catch it before it ships.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makePr, withChecks, withReviewDecision } from "./fixtures";
import type { FetchResult, PrElementChanges } from "../types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockState } = vi.hoisted(() => {
  const mockState = {
    currentResult: null as FetchResult | null,
    currentAttentionUrls: [] as string[],
    activeTab: "mine" as string,
    activeFollowFilter: "all",
    showAuthorInCards: false,
    groupByRepository: false,
    hiddenOrgs: new Set<string>(),
    hiddenRepos: new Set<string>(),
    hiddenPrs: new Map<string, string>(),
    followedUsers: [] as string[],
    followedPrs: new Set<string>(),
    collapsedAccordions: new Set<string>(),
    favoriteOrgs: new Set<string>(),
    favoriteRepos: new Set<string>(),
    pendingUnhideOrgs: new Set<string>(),
    pendingUnhideRepos: new Set<string>(),
    autoFollowedPrUrls: new Set<string>(),
    unseenRequestUrls: new Set<string>(),
    searchQuery: "",
    focusIndex: -1,
    setCurrentAttentionUrls: vi.fn((urls: string[]) => { mockState.currentAttentionUrls = urls; }),
    setCurrentResult: vi.fn((r: FetchResult | null) => { mockState.currentResult = r; }),
    setActiveTabState: vi.fn((tab: string) => { mockState.activeTab = tab; }),
    setActiveFollowFilter: vi.fn((f: string) => { mockState.activeFollowFilter = f; }),
    setShowAuthorInCards: vi.fn((v: boolean) => { mockState.showAuthorInCards = v; }),
    setGroupByRepository: vi.fn(),
    setFocusIndex: vi.fn((i: number) => { mockState.focusIndex = i; }),
    setFollowedUsers: vi.fn((users: string[]) => { mockState.followedUsers = users; }),
    setSearchQuery: vi.fn((q: string) => { mockState.searchQuery = q; }),
    setShowRecentlyMerged: vi.fn(),
    setShowClosed: vi.fn(),
    setSidebarFocus: vi.fn(),
    setPopoverFocusIndex: vi.fn(),
    setSettingsNavIndex: vi.fn(),
    setSettingsGroupIndex: vi.fn(),
    setReleaseNotesOpen: vi.fn(),
    setReleaseNotesIndex: vi.fn(),
    setKbDismissTimer: vi.fn(),
    setLastWorkflowConclusion: vi.fn(),
    setWorkflowHasAttention: vi.fn(),
    setViewerLogin: vi.fn(),
    setKeybindings: vi.fn(),
    clearPendingUnhide: vi.fn(),
    addUnseenRequestUrl: vi.fn((url: string) => { mockState.unseenRequestUrls.add(url); }),
    removeUnseenRequestUrl: vi.fn((url: string) => { mockState.unseenRequestUrls.delete(url); }),
    showRecentlyMerged: false,
    showClosed: false,
    sidebarFocus: null as string | null,
    popoverFocusIndex: -1,
    settingsNavIndex: 0,
    settingsGroupIndex: -1,
    releaseNotesOpen: false,
    releaseNotesIndex: 0,
    kbDismissTimer: null,
    lastWorkflowConclusion: null as string | null,
    workflowHasAttention: false,
    viewerLogin: "",
    keybindings: {} as Record<string, string>,
  };
  return { mockState };
});

vi.mock("../state", () => mockState);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({
    hidden_prs: [],
    followed_prs: [],
    favorite_orgs: [],
    favorite_repos: [],
    collapsed_accordions: [],
    hidden_orgs: [],
    hidden_repos: [],
    followed_users: [],
  }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("../prefs", () => ({
  persistPrefs: vi.fn(),
  toggleFavorite: vi.fn(),
  toggleHidden: vi.fn(),
  initPrefs: vi.fn(),
  loadUserPrefs: vi.fn(),
}));

import { renderActiveTab, updateTabBadges, bindContentEvents } from "../tabs";
import { renderPrCard, filterPrs } from "../renderer";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetchResult(overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    open: [],
    recently_merged: [],
    recently_closed: [],
    followed_open: [],
    followed_recently_merged: [],
    followed_recently_closed: [],
    attention_urls: [],
    element_changes: {},
    workflow_status: null,
    viewer_login: "me",
    viewer_avatar_url: "",
    ...overrides,
  };
}

function setupDom() {
  document.body.innerHTML = `
    <div id="content"></div>
    <div id="main-nav">
      <button class="nav-item" data-tab="mine"></button>
      <button class="nav-item" data-tab="followed"></button>
      <button class="nav-item" data-tab="merged"></button>
      <button class="nav-item" data-tab="closed"></button>
    </div>
    <div id="avatar-menu"></div>
    <button id="signout-btn"><span class="popover-label">Sign out</span></button>
  `;
}

function allChanges(overrides: Partial<PrElementChanges> = {}): PrElementChanges {
  return {
    became_review_required: false,
    became_changes_requested: false,
    became_approved: false,
    checks_failed: false,
    checks_recovered: false,
    kicked_from_queue: false,
    new_comment: false,
    new_comment_participated: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.currentResult = null;
  mockState.currentAttentionUrls = [];
  mockState.activeTab = "mine";
  mockState.activeFollowFilter = "all";
  mockState.showAuthorInCards = false;
  mockState.groupByRepository = false;
  mockState.hiddenOrgs.clear();
  mockState.hiddenRepos.clear();
  mockState.hiddenPrs.clear();
  mockState.followedUsers = [];
  mockState.followedPrs.clear();
  mockState.collapsedAccordions.clear();
  mockState.searchQuery = "";
  mockState.focusIndex = -1;
  setupDom();
});

// ---------------------------------------------------------------------------
// Attention data flow: FetchResult → rendering → badges
// ---------------------------------------------------------------------------

describe("attention data flow", () => {
  const pr1 = makePr({
    title: "Fix auth bug",
    url: "https://github.com/org/repo/pull/1",
  });
  const pr2 = makePr({
    title: "Add feature",
    url: "https://github.com/org/repo/pull/2",
    repository: { name: "repo", owner: { login: "org" } },
  });
  const pr3 = makePr({
    title: "Update docs",
    url: "https://github.com/org/repo/pull/3",
    repository: { name: "repo", owner: { login: "org" } },
  });

  it("PR card gets attention class when its URL is in attention_urls", () => {
    mockState.currentAttentionUrls = [pr1.url];
    mockState.currentResult = makeFetchResult({ open: [pr1, pr2] });
    renderActiveTab();

    const cards = document.querySelectorAll(".pr-card");
    expect(cards).toHaveLength(2);

    const card1 = document.querySelector(`.pr-card[data-url="${pr1.url}"]`);
    const card2 = document.querySelector(`.pr-card[data-url="${pr2.url}"]`);
    expect(card1?.classList.contains("attention")).toBe(true);
    expect(card2?.classList.contains("attention")).toBe(false);
  });

  it("tab badge shows correct attention count for owned PRs", () => {
    mockState.currentAttentionUrls = [pr1.url, pr2.url];
    mockState.currentResult = makeFetchResult({ open: [pr1, pr2, pr3] });
    renderActiveTab();

    const mineTab = document.querySelector('.nav-item[data-tab="mine"]');
    const badge = mineTab?.querySelector(".tab-badge");
    expect(badge?.textContent).toBe("2");
  });

  it("tab badge shows correct attention count for followed PRs", () => {
    mockState.currentAttentionUrls = [pr1.url];
    mockState.currentResult = makeFetchResult({
      open: [],
      followed_open: [pr1, pr2],
    });
    renderActiveTab();

    const followedTab = document.querySelector('.nav-item[data-tab="followed"]');
    const badge = followedTab?.querySelector(".tab-badge");
    expect(badge?.textContent).toBe("1");
  });

  it("tab badge removed when no attention PRs", () => {
    mockState.currentAttentionUrls = [];
    mockState.currentResult = makeFetchResult({ open: [pr1] });
    renderActiveTab();

    const mineTab = document.querySelector('.nav-item[data-tab="mine"]');
    expect(mineTab?.querySelector(".tab-badge")).toBeNull();
  });

  it("merged tab badge counts attention PRs in both owned and followed merged", () => {
    const mergedPr = makePr({
      url: "https://github.com/org/repo/pull/10",
      state: "MERGED",
      merged: true,
    });
    mockState.currentAttentionUrls = [mergedPr.url];
    mockState.currentResult = makeFetchResult({
      recently_merged: [mergedPr],
    });
    renderActiveTab();

    const mergedTab = document.querySelector('.nav-item[data-tab="merged"]');
    const badge = mergedTab?.querySelector(".tab-badge");
    expect(badge?.textContent).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// Element changes → visual highlights on PR cards
// ---------------------------------------------------------------------------

describe("element changes highlights", () => {
  it("review change adds highlight-changed to review status span", () => {
    const pr = withReviewDecision(
      makePr({ url: "https://github.com/org/repo/pull/1", reviews: { totalCount: 2 } }),
      "APPROVED",
    );
    mockState.currentAttentionUrls = [pr.url];
    mockState.currentResult = makeFetchResult({
      open: [pr],
      element_changes: {
        [pr.url]: allChanges({ became_approved: true }),
      },
    });

    const html = renderPrCard(pr);
    expect(html).toContain("highlight-changed");
    expect(html).toContain("approved");
  });

  it("checks_failed adds highlight-changed to checks span", () => {
    const pr = withChecks(
      makePr({ url: "https://github.com/org/repo/pull/1" }),
      "FAILURE",
    );
    mockState.currentAttentionUrls = [pr.url];
    mockState.currentResult = makeFetchResult({
      open: [pr],
      element_changes: {
        [pr.url]: allChanges({ checks_failed: true }),
      },
    });

    const html = renderPrCard(pr);
    expect(html).toContain("highlight-changed");
    expect(html).toContain("checks failed");
  });

  it("new_comment adds highlight-attention to comments span", () => {
    const pr = makePr({
      url: "https://github.com/org/repo/pull/1",
      comments: { totalCount: 5 },
    });
    mockState.currentAttentionUrls = [pr.url];
    mockState.currentResult = makeFetchResult({
      open: [pr],
      element_changes: {
        [pr.url]: allChanges({ new_comment: true }),
      },
    });

    const html = renderPrCard(pr);
    expect(html).toContain("highlight-attention");
  });

  it("no element changes means no highlight classes", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1" });
    mockState.currentAttentionUrls = [pr.url];
    mockState.currentResult = makeFetchResult({
      open: [pr],
      element_changes: {},
    });

    const html = renderPrCard(pr);
    expect(html).not.toContain("highlight-changed");
    expect(html).not.toContain("highlight-attention");
  });

  it("multiple element changes on same PR all apply", () => {
    const pr = withChecks(
      withReviewDecision(
        makePr({
          url: "https://github.com/org/repo/pull/1",
          comments: { totalCount: 3 },
          reviews: { totalCount: 1 },
        }),
        "CHANGES_REQUESTED",
      ),
      "FAILURE",
    );
    mockState.currentAttentionUrls = [pr.url];
    mockState.currentResult = makeFetchResult({
      open: [pr],
      element_changes: {
        [pr.url]: allChanges({
          became_changes_requested: true,
          checks_failed: true,
          new_comment: true,
        }),
      },
    });

    const html = renderPrCard(pr);
    // Both highlight-changed (for review + checks) and highlight-attention (for comments)
    expect(html).toContain("highlight-changed");
    expect(html).toContain("highlight-attention");
  });
});

// ---------------------------------------------------------------------------
// Attention dismiss flow: click → remove class → update state → update badges
// ---------------------------------------------------------------------------

describe("attention dismiss on PR click", () => {
  it("clicking an attention PR removes attention class, calls dismiss_pr, updates badges", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1" });
    mockState.currentAttentionUrls = [pr.url];
    mockState.currentResult = makeFetchResult({
      open: [pr],
      element_changes: {},
    });
    renderActiveTab();

    // Verify card has attention class before click
    const card = document.querySelector(`.pr-card[data-url="${pr.url}"]`) as HTMLElement;
    expect(card.classList.contains("attention")).toBe(true);

    // Verify badge shows 1
    const mineTab = document.querySelector('.nav-item[data-tab="mine"]');
    expect(mineTab?.querySelector(".tab-badge")?.textContent).toBe("1");

    // Click the card
    card.click();

    // Card opened
    expect(openUrl).toHaveBeenCalledWith(pr.url);

    // Attention class removed
    expect(card.classList.contains("attention")).toBe(false);

    // dismiss_pr called
    expect(invoke).toHaveBeenCalledWith("dismiss_pr", { url: pr.url });

    // Attention URLs updated (removed the dismissed URL)
    expect(mockState.setCurrentAttentionUrls).toHaveBeenCalledWith([]);

    // Badge removed
    expect(mineTab?.querySelector(".tab-badge")).toBeNull();
  });

  it("clicking a non-attention PR opens URL but does not call dismiss_pr", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1" });
    mockState.currentAttentionUrls = [];
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    const card = document.querySelector(`.pr-card[data-url="${pr.url}"]`) as HTMLElement;
    card.click();

    expect(openUrl).toHaveBeenCalledWith(pr.url);
    expect(invoke).not.toHaveBeenCalledWith("dismiss_pr", expect.anything());
  });

  it("dismissing one of multiple attention PRs updates badge to remaining count", () => {
    const pr1 = makePr({ url: "https://github.com/org/repo/pull/1" });
    const pr2 = makePr({ url: "https://github.com/org/repo/pull/2" });
    mockState.currentAttentionUrls = [pr1.url, pr2.url];
    mockState.currentResult = makeFetchResult({ open: [pr1, pr2] });
    renderActiveTab();

    // Badge shows 2
    const mineTab = document.querySelector('.nav-item[data-tab="mine"]');
    expect(mineTab?.querySelector(".tab-badge")?.textContent).toBe("2");

    // Dismiss first PR
    const card1 = document.querySelector(`.pr-card[data-url="${pr1.url}"]`) as HTMLElement;
    card1.click();

    // Badge shows 1
    expect(mineTab?.querySelector(".tab-badge")?.textContent).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// Attention dismiss on hover (300ms delayed)
// ---------------------------------------------------------------------------

describe("attention dismiss on hover", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hovering an attention card for 300ms+ dismisses it", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1" });
    mockState.currentAttentionUrls = [pr.url];
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    const card = document.querySelector(`.pr-card[data-url="${pr.url}"]`) as HTMLElement;
    expect(card.classList.contains("attention")).toBe(true);

    // Need to advance past the 500ms readyToHover guard
    vi.advanceTimersByTime(500);

    card.dispatchEvent(new MouseEvent("mouseenter"));
    // Not yet dismissed
    expect(card.classList.contains("attention")).toBe(true);

    vi.advanceTimersByTime(300);
    // Now dismissed
    expect(card.classList.contains("attention")).toBe(false);
    expect(invoke).toHaveBeenCalledWith("dismiss_pr", { url: pr.url });
  });

  it("leaving before 300ms cancels the dismiss", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1" });
    mockState.currentAttentionUrls = [pr.url];
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    const card = document.querySelector(`.pr-card[data-url="${pr.url}"]`) as HTMLElement;

    vi.advanceTimersByTime(500);

    card.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(100); // only 100ms, not 300ms
    card.dispatchEvent(new MouseEvent("mouseleave"));

    vi.advanceTimersByTime(500); // advance well past 300ms total
    // Still has attention - dismiss was cancelled
    expect(card.classList.contains("attention")).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith("dismiss_pr", expect.anything());
  });

  it("hovering too early (within 500ms of render) does not start dismiss", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1" });
    mockState.currentAttentionUrls = [pr.url];
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    const card = document.querySelector(`.pr-card[data-url="${pr.url}"]`) as HTMLElement;

    // Hover immediately (within 500ms guard)
    card.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(1000);

    // Still has attention
    expect(card.classList.contains("attention")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Attention filter integration
// ---------------------------------------------------------------------------

describe("attention filter", () => {
  it("filterPrs with attention filter returns only PRs in currentAttentionUrls", () => {
    const pr1 = makePr({ url: "https://github.com/org/repo/pull/1" });
    const pr2 = makePr({ url: "https://github.com/org/repo/pull/2" });
    const pr3 = makePr({ url: "https://github.com/org/repo/pull/3" });

    mockState.currentAttentionUrls = [pr1.url, pr3.url];

    const result = filterPrs([pr1, pr2, pr3], "", "attention");
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe(pr1.url);
    expect(result[1].url).toBe(pr3.url);
  });

  it("attention filter with search query narrows results further", () => {
    const pr1 = makePr({ title: "Fix auth", url: "https://github.com/org/repo/pull/1" });
    const pr2 = makePr({ title: "Add feature", url: "https://github.com/org/repo/pull/2" });

    mockState.currentAttentionUrls = [pr1.url, pr2.url];

    const result = filterPrs([pr1, pr2], "auth", "attention");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Fix auth");
  });
});

// ---------------------------------------------------------------------------
// PR information updates correctly across re-renders
// ---------------------------------------------------------------------------

describe("PR information updates on re-render", () => {
  it("re-rendering with new data updates PR cards", () => {
    const pr = withReviewDecision(
      makePr({ url: "https://github.com/org/repo/pull/1", reviews: { totalCount: 0 } }),
      null,
    );
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    // Initial state: no review status
    let card = document.querySelector(`.pr-card[data-url="${pr.url}"]`);
    expect(card?.innerHTML).not.toContain("approved");

    // Update: PR now approved with 2 reviews
    const updatedPr = withReviewDecision(
      makePr({ url: "https://github.com/org/repo/pull/1", reviews: { totalCount: 2 } }),
      "APPROVED",
    );
    mockState.currentResult = makeFetchResult({ open: [updatedPr] });
    renderActiveTab();

    card = document.querySelector(`.pr-card[data-url="${pr.url}"]`);
    expect(card?.innerHTML).toContain("approved");
    expect(card?.innerHTML).toContain("☑ 2");
  });

  it("re-rendering with new attention URLs updates card classes", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1" });

    // First render: no attention
    mockState.currentAttentionUrls = [];
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    let card = document.querySelector(`.pr-card[data-url="${pr.url}"]`);
    expect(card?.classList.contains("attention")).toBe(false);

    // Second render: PR now needs attention
    mockState.currentAttentionUrls = [pr.url];
    mockState.currentResult = makeFetchResult({
      open: [pr],
      attention_urls: [pr.url],
    });
    renderActiveTab();

    card = document.querySelector(`.pr-card[data-url="${pr.url}"]`);
    expect(card?.classList.contains("attention")).toBe(true);
  });

  it("re-rendering with updated checks status reflects in card", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1" });
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    let card = document.querySelector(`.pr-card[data-url="${pr.url}"]`);
    expect(card?.innerHTML).toContain("no checks");

    // Update: checks now failing
    const failingPr = withChecks(
      makePr({ url: "https://github.com/org/repo/pull/1" }),
      "FAILURE",
    );
    mockState.currentResult = makeFetchResult({ open: [failingPr] });
    renderActiveTab();

    card = document.querySelector(`.pr-card[data-url="${pr.url}"]`);
    expect(card?.innerHTML).toContain("checks failed");
  });

  it("PR removed from open list disappears from rendered cards", () => {
    const pr1 = makePr({ url: "https://github.com/org/repo/pull/1" });
    const pr2 = makePr({ url: "https://github.com/org/repo/pull/2" });

    mockState.currentResult = makeFetchResult({ open: [pr1, pr2] });
    renderActiveTab();
    expect(document.querySelectorAll(".pr-card")).toHaveLength(2);

    // PR1 merged, removed from open
    mockState.currentResult = makeFetchResult({ open: [pr2] });
    renderActiveTab();
    expect(document.querySelectorAll(".pr-card")).toHaveLength(1);
    expect(document.querySelector(`.pr-card[data-url="${pr1.url}"]`)).toBeNull();
  });

  it("comment count updates when threads are added", () => {
    const pr = makePr({
      url: "https://github.com/org/repo/pull/1",
      comments: { totalCount: 2 },
      reviewThreads: { nodes: [] },
    });
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    // Update: new unresolved thread with 3 comments
    const updatedPr = makePr({
      url: "https://github.com/org/repo/pull/1",
      comments: { totalCount: 2 },
      reviewThreads: {
        nodes: [{ isResolved: false, comments: { totalCount: 3 } }],
      },
    });
    mockState.currentResult = makeFetchResult({ open: [updatedPr] });
    renderActiveTab();

    const card = document.querySelector(`.pr-card[data-url="${pr.url}"]`);
    // Total comments = 2 (direct) + 3 (unresolved thread) = 5
    expect(card?.innerHTML).toContain(" 5");
  });

  it("resolved threads count updates correctly", () => {
    const pr = makePr({
      url: "https://github.com/org/repo/pull/1",
      reviewThreads: {
        nodes: [
          { isResolved: false, comments: { totalCount: 2 } },
          { isResolved: true, comments: { totalCount: 1 } },
        ],
      },
    });
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    const card = document.querySelector(`.pr-card[data-url="${pr.url}"]`);
    // 1 resolved thread
    expect(card?.innerHTML).toContain("▣ 1");

    // Update: second thread also resolved
    const updatedPr = makePr({
      url: "https://github.com/org/repo/pull/1",
      reviewThreads: {
        nodes: [
          { isResolved: true, comments: { totalCount: 2 } },
          { isResolved: true, comments: { totalCount: 1 } },
        ],
      },
    });
    mockState.currentResult = makeFetchResult({ open: [updatedPr] });
    renderActiveTab();

    const updatedCard = document.querySelector(`.pr-card[data-url="${pr.url}"]`);
    expect(updatedCard?.innerHTML).toContain("▣ 2");
  });

  it("draft PR converted to open reflects updated status", () => {
    const draft = makePr({
      url: "https://github.com/org/repo/pull/1",
      isDraft: true,
      state: "OPEN",
    });
    mockState.currentResult = makeFetchResult({ open: [draft] });
    renderActiveTab();

    let card = document.querySelector(`.pr-card[data-url="${draft.url}"]`);
    expect(card?.querySelector(".pr-status")?.classList.contains("draft")).toBe(true);
    expect(card?.innerHTML).toContain("draft");

    // Convert to open (no longer draft)
    const openPr = makePr({
      url: "https://github.com/org/repo/pull/1",
      isDraft: false,
      state: "OPEN",
    });
    mockState.currentResult = makeFetchResult({ open: [openPr] });
    renderActiveTab();

    card = document.querySelector(`.pr-card[data-url="${draft.url}"]`);
    expect(card?.querySelector(".pr-status")?.classList.contains("open")).toBe(true);
    expect(card?.querySelector(".pr-status")?.classList.contains("draft")).toBe(false);
  });

  it("PR entering merge queue shows queue position", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1" });
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    let card = document.querySelector(`.pr-card[data-url="${pr.url}"]`);
    expect(card?.innerHTML).not.toContain("in queue");

    // PR enters merge queue
    const queuedPr = makePr({
      url: "https://github.com/org/repo/pull/1",
      mergeQueueEntry: { position: 3 },
    });
    mockState.currentResult = makeFetchResult({ open: [queuedPr] });
    renderActiveTab();

    card = document.querySelector(`.pr-card[data-url="${pr.url}"]`);
    expect(card?.innerHTML).toContain("in queue #3");
    expect(card?.querySelector(".pr-status")?.classList.contains("in-queue")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Followed tab attention with per-user filter
// ---------------------------------------------------------------------------

describe("followed tab attention flow", () => {
  it("followed tab shows attention badges per user in filter bar", () => {
    const alicePr = makePr({
      url: "https://github.com/org/repo/pull/1",
      author: { login: "alice" },
    });
    const bobPr = makePr({
      url: "https://github.com/org/repo/pull/2",
      author: { login: "bob" },
    });

    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob"];
    mockState.currentAttentionUrls = [alicePr.url];
    mockState.currentResult = makeFetchResult({
      followed_open: [alicePr, bobPr],
    });
    renderActiveTab();

    // Alice's filter button should have a badge
    const aliceBtn = document.querySelector('.follow-filter-btn[data-filter="alice"]');
    expect(aliceBtn?.querySelector(".tab-badge")?.textContent).toBe("1");

    // Bob's filter button should have no badge
    const bobBtn = document.querySelector('.follow-filter-btn[data-filter="bob"]');
    expect(bobBtn?.querySelector(".tab-badge")).toBeNull();

    // "All" button should show total
    const allBtn = document.querySelector('.follow-filter-btn[data-filter="all"]');
    expect(allBtn?.querySelector(".tab-badge")?.textContent).toBe("1");
  });

  it("filtering by user shows only that user's PRs", () => {
    const alicePr = makePr({
      url: "https://github.com/org/repo/pull/1",
      author: { login: "alice" },
      title: "Alice PR",
    });
    const bobPr = makePr({
      url: "https://github.com/org/repo/pull/2",
      author: { login: "bob" },
      title: "Bob PR",
    });

    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob"];
    mockState.activeFollowFilter = "alice";
    mockState.currentResult = makeFetchResult({
      followed_open: [alicePr, bobPr],
    });
    renderActiveTab();

    const cards = document.querySelectorAll(".pr-card");
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute("data-url")).toBe(alicePr.url);
  });

  it("direct filter shows only directly followed PRs", () => {
    const followedPr = makePr({
      url: "https://github.com/org/repo/pull/1",
      author: { login: "alice" },
    });
    const userPr = makePr({
      url: "https://github.com/org/repo/pull/2",
      author: { login: "alice" },
    });

    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice"];
    mockState.followedPrs.add(followedPr.url);
    mockState.activeFollowFilter = "direct";
    mockState.currentResult = makeFetchResult({
      followed_open: [followedPr, userPr],
    });
    renderActiveTab();

    const cards = document.querySelectorAll(".pr-card");
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute("data-url")).toBe(followedPr.url);
  });
});
