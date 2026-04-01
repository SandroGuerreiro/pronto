import { describe, it, expect, vi, beforeEach } from "vitest";
import { makePr } from "./fixtures";
import type { FetchResult } from "../types";

// ---------------------------------------------------------------------------
// Mocks — vi.mock is hoisted, so use vi.hoisted for shared state
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
    searchQuery: "",
    focusIndex: -1,
    setCurrentAttentionUrls: vi.fn((urls: string[]) => { mockState.currentAttentionUrls = urls; }),
    setCurrentResult: vi.fn((r: FetchResult | null) => { mockState.currentResult = r; }),
    setActiveTabState: vi.fn((tab: string) => { mockState.activeTab = tab; }),
    setActiveFollowFilter: vi.fn((f: string) => { mockState.activeFollowFilter = f; }),
    setShowAuthorInCards: vi.fn((v: boolean) => { mockState.showAuthorInCards = v; }),
    setGroupByRepository: vi.fn((v: boolean) => { mockState.groupByRepository = v; }),
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

import { renderActiveTab, setActiveTab, updateTabBadges, hideCurrentFocusPr } from "../tabs";

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

function resetMockState() {
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
}

/** Query focusable items using the same selector as getFocusables() in main.ts */
function getFocusables(): Element[] {
  const content = document.getElementById("content")!;
  return [...content.querySelectorAll(
    "#pr-search-input, .follow-filter-btn[data-filter], summary.accordion-header, .pr-card"
  )];
}

beforeEach(() => {
  resetMockState();
  setupDom();
  vi.clearAllMocks();
  vi.useFakeTimers();
});

// ---------------------------------------------------------------------------
// renderActiveTab — Mine tab
// ---------------------------------------------------------------------------

describe("renderActiveTab — mine", () => {
  it("renders empty state when no PRs", () => {
    mockState.activeTab = "mine";
    mockState.currentResult = makeFetchResult();
    renderActiveTab();
    expect(document.getElementById("content")!.innerHTML).toContain("No open PRs");
  });

  it("renders PR cards for open PRs", () => {
    const pr = makePr({ title: "My PR", url: "https://github.com/org/repo/pull/1" });
    mockState.activeTab = "mine";
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();
    const content = document.getElementById("content")!;
    expect(content.querySelector(".pr-card")).toBeTruthy();
    expect(content.innerHTML).toContain("My PR");
  });

  it("renders search bar", () => {
    mockState.activeTab = "mine";
    mockState.currentResult = makeFetchResult({ open: [makePr()] });
    renderActiveTab();
    expect(document.getElementById("pr-search-input")).toBeTruthy();
  });

  it("shows no-match message when search has no results", () => {
    mockState.activeTab = "mine";
    mockState.searchQuery = "nonexistent";
    mockState.currentResult = makeFetchResult({ open: [makePr()] });
    renderActiveTab();
    expect(document.getElementById("content")!.innerHTML).toContain("No PRs match");
  });
});

// ---------------------------------------------------------------------------
// renderActiveTab — Followed tab
// ---------------------------------------------------------------------------

describe("renderActiveTab — followed", () => {
  it("renders empty state with no followed users or PRs", () => {
    mockState.activeTab = "followed";
    mockState.followedUsers = [];
    mockState.followedPrs.clear();
    mockState.currentResult = makeFetchResult();
    renderActiveTab();
    expect(document.getElementById("content")!.innerHTML).toContain("No followed developers");
  });

  it("renders followed PRs when followed users exist", () => {
    const pr = makePr({ title: "Alice PR", author: { login: "alice" } });
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice"];
    mockState.currentResult = makeFetchResult({ followed_open: [pr] });
    renderActiveTab();
    const content = document.getElementById("content")!;
    expect(content.querySelector(".pr-card")).toBeTruthy();
    expect(content.innerHTML).toContain("Alice PR");
  });

  it("renders search bar in followed tab", () => {
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice"];
    mockState.currentResult = makeFetchResult({ followed_open: [makePr()] });
    renderActiveTab();
    expect(document.getElementById("pr-search-input")).toBeTruthy();
  });

  it("renders filter bar when multiple followed users", () => {
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob"];
    mockState.currentResult = makeFetchResult({ followed_open: [] });
    renderActiveTab();
    const content = document.getElementById("content")!;
    expect(content.querySelector(".follow-filter-bar")).toBeTruthy();
    expect(content.querySelector('[data-filter="all"]')).toBeTruthy();
  });

  it("renders Direct filter button when followed PRs exist", () => {
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice"];
    mockState.followedPrs.add("https://github.com/org/repo/pull/99");
    mockState.currentResult = makeFetchResult({ followed_open: [] });
    renderActiveTab();
    expect(document.querySelector('[data-filter="direct"]')).toBeTruthy();
  });

  it("filters by specific user when filter is set", () => {
    const alicePr = makePr({ title: "Alice PR", author: { login: "alice" }, url: "https://github.com/org/repo/pull/1" });
    const bobPr = makePr({ title: "Bob PR", author: { login: "bob" }, url: "https://github.com/org/repo/pull/2" });
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob"];
    mockState.activeFollowFilter = "alice";
    mockState.currentResult = makeFetchResult({ followed_open: [alicePr, bobPr] });
    renderActiveTab();
    const cards = document.querySelectorAll(".pr-card");
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute("data-url")).toBe("https://github.com/org/repo/pull/1");
  });

  it("filters direct-follow PRs when filter is 'direct'", () => {
    const directUrl = "https://github.com/org/repo/pull/1";
    const directPr = makePr({ title: "Direct", url: directUrl, author: { login: "alice" } });
    const userPr = makePr({ title: "User PR", url: "https://github.com/org/repo/pull/2", author: { login: "alice" } });
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice"];
    mockState.followedPrs.add(directUrl);
    mockState.activeFollowFilter = "direct";
    mockState.currentResult = makeFetchResult({ followed_open: [directPr, userPr] });
    renderActiveTab();
    const cards = document.querySelectorAll(".pr-card");
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute("data-url")).toBe(directUrl);
  });
});

// ---------------------------------------------------------------------------
// renderActiveTab — Merged tab
// ---------------------------------------------------------------------------

describe("renderActiveTab — merged", () => {
  it("renders empty state when no merged PRs", () => {
    mockState.activeTab = "merged";
    mockState.currentResult = makeFetchResult();
    renderActiveTab();
    expect(document.getElementById("content")!.innerHTML).toContain("No recently merged");
  });

  it("renders owned section for user's merged PRs", () => {
    const pr = makePr({ state: "MERGED", merged: true });
    mockState.activeTab = "merged";
    mockState.currentResult = makeFetchResult({ recently_merged: [pr] });
    renderActiveTab();
    expect(document.getElementById("content")!.innerHTML).toContain("Owned");
  });

  it("renders following section for followed users' merged PRs", () => {
    const pr = makePr({ state: "MERGED", merged: true, author: { login: "alice" } });
    mockState.activeTab = "merged";
    mockState.currentResult = makeFetchResult({ followed_recently_merged: [pr] });
    renderActiveTab();
    expect(document.getElementById("content")!.innerHTML).toContain("Following");
  });
});

// ---------------------------------------------------------------------------
// renderActiveTab — Closed tab
// ---------------------------------------------------------------------------

describe("renderActiveTab — closed", () => {
  it("renders empty state when no closed PRs", () => {
    mockState.activeTab = "closed";
    mockState.currentResult = makeFetchResult();
    renderActiveTab();
    expect(document.getElementById("content")!.innerHTML).toContain("No recently closed");
  });

  it("renders owned and following sections", () => {
    const mine = makePr({ state: "CLOSED" });
    const following = makePr({ state: "CLOSED", author: { login: "bob" }, url: "https://github.com/org/repo/pull/2" });
    mockState.activeTab = "closed";
    mockState.currentResult = makeFetchResult({
      recently_closed: [mine],
      followed_recently_closed: [following],
    });
    renderActiveTab();
    const html = document.getElementById("content")!.innerHTML;
    expect(html).toContain("Owned");
    expect(html).toContain("Following");
  });
});

// ---------------------------------------------------------------------------
// renderActiveTab — guards
// ---------------------------------------------------------------------------

describe("renderActiveTab — guards", () => {
  it("does not render when activeTab is settings", () => {
    mockState.activeTab = "settings";
    mockState.currentResult = makeFetchResult();
    renderActiveTab();
    expect(document.getElementById("content")!.innerHTML).toBe("");
  });

  it("does not render when currentResult is null", () => {
    mockState.activeTab = "mine";
    mockState.currentResult = null;
    renderActiveTab();
    expect(document.getElementById("content")!.innerHTML).toBe("");
  });
});

// ---------------------------------------------------------------------------
// setActiveTab
// ---------------------------------------------------------------------------

describe("setActiveTab", () => {
  it("updates active tab state", () => {
    mockState.currentResult = makeFetchResult();
    setActiveTab("followed");
    expect(mockState.setActiveTabState).toHaveBeenCalledWith("followed");
  });

  it("resets search query on tab switch", () => {
    mockState.currentResult = makeFetchResult();
    mockState.searchQuery = "old query";
    setActiveTab("mine");
    expect(mockState.setSearchQuery).toHaveBeenCalledWith("");
  });

  it("sets active class on correct nav button", () => {
    mockState.currentResult = makeFetchResult();
    setActiveTab("followed");
    const followedBtn = document.querySelector('[data-tab="followed"]')!;
    const mineBtn = document.querySelector('[data-tab="mine"]')!;
    expect(followedBtn.classList.contains("active")).toBe(true);
    expect(mineBtn.classList.contains("active")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateTabBadges
// ---------------------------------------------------------------------------

describe("updateTabBadges", () => {
  it("adds badge to tab with attention PRs", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1" });
    mockState.currentResult = makeFetchResult({ open: [pr] });
    mockState.currentAttentionUrls = ["https://github.com/org/repo/pull/1"];
    updateTabBadges();
    const mineBtn = document.querySelector('[data-tab="mine"]')!;
    const badge = mineBtn.querySelector(".tab-badge");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("1");
  });

  it("removes badge when no attention PRs", () => {
    mockState.currentResult = makeFetchResult({ open: [makePr()] });
    mockState.currentAttentionUrls = [];
    const mineBtn = document.querySelector('[data-tab="mine"]')!;
    const span = document.createElement("span");
    span.className = "tab-badge";
    span.textContent = "1";
    mineBtn.appendChild(span);
    updateTabBadges();
    expect(mineBtn.querySelector(".tab-badge")).toBeNull();
  });

  it("shows badge on followed tab for followed attention PRs", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/5" });
    mockState.currentResult = makeFetchResult({ followed_open: [pr] });
    mockState.currentAttentionUrls = ["https://github.com/org/repo/pull/5"];
    updateTabBadges();
    const followedBtn = document.querySelector('[data-tab="followed"]')!;
    expect(followedBtn.querySelector(".tab-badge")!.textContent).toBe("1");
  });

  it("does nothing when currentResult is null", () => {
    mockState.currentResult = null;
    updateTabBadges(); // should not throw
  });
});

// ---------------------------------------------------------------------------
// hideCurrentFocusPr
// ---------------------------------------------------------------------------

describe("hideCurrentFocusPr", () => {
  const prUrl = "https://github.com/org/repo/pull/42";
  const prTitle = "Some PR";

  function setupFollowedTabWithPrs() {
    const pr = makePr({ title: prTitle, url: prUrl, author: { login: "alice" } });
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob"];
    mockState.currentResult = makeFetchResult({ followed_open: [pr] });
    renderActiveTab();
  }

  function setupMineTabWithPrs() {
    const pr = makePr({ title: prTitle, url: prUrl });
    mockState.activeTab = "mine";
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();
  }

  it("returns false when focusIndex is negative", async () => {
    setupMineTabWithPrs();
    expect(await hideCurrentFocusPr(-1)).toBe(false);
  });

  it("returns false when focusIndex exceeds items length", async () => {
    setupMineTabWithPrs();
    expect(await hideCurrentFocusPr(999)).toBe(false);
  });

  it("returns false when focused element is not a pr-card (e.g. search input)", async () => {
    setupMineTabWithPrs();
    // Index 0 is the search input
    expect(await hideCurrentFocusPr(0)).toBe(false);
  });

  it("hides PR in mine tab with correct focusIndex", async () => {
    setupMineTabWithPrs();
    // Items: [searchInput, prCard] → index 1 is the PR card
    const items = getFocusables();
    expect(items[0].id).toBe("pr-search-input");
    expect(items[1].classList.contains("pr-card")).toBe(true);

    const promise = hideCurrentFocusPr(1);
    vi.advanceTimersByTime(400);
    const result = await promise;
    expect(result).toBe(true);
    expect(mockState.hiddenPrs.has(prUrl)).toBe(true);
  });

  it("hides PR in followed tab accounting for search + filter buttons", async () => {
    setupFollowedTabWithPrs();
    const items = getFocusables();

    // Verify the items include search input and filter buttons before the PR card
    expect(items[0].id).toBe("pr-search-input");
    const filterCount = items.filter((el) => el.classList.contains("follow-filter-btn")).length;
    expect(filterCount).toBeGreaterThan(0);

    const prCardIndex = items.findIndex((el) => el.classList.contains("pr-card"));
    expect(prCardIndex).toBeGreaterThan(1); // Must be after search + filters

    const promise = hideCurrentFocusPr(prCardIndex);
    vi.advanceTimersByTime(400);
    const result = await promise;
    expect(result).toBe(true);
    expect(mockState.hiddenPrs.has(prUrl)).toBe(true);
  });

  it("returns false when focusIndex lands on a filter button", async () => {
    setupFollowedTabWithPrs();
    const items = getFocusables();
    const filterIndex = items.findIndex((el) => el.classList.contains("follow-filter-btn"));
    expect(filterIndex).toBeGreaterThanOrEqual(0);
    expect(await hideCurrentFocusPr(filterIndex)).toBe(false);
  });

  it("removes PR from followed_open in currentResult", async () => {
    setupFollowedTabWithPrs();
    const items = getFocusables();
    const prCardIndex = items.findIndex((el) => el.classList.contains("pr-card"));

    const promise = hideCurrentFocusPr(prCardIndex);
    vi.advanceTimersByTime(400);
    await promise;
    expect(mockState.currentResult!.followed_open).toHaveLength(0);
  });

  it("removes directly followed PR from followedPrs AND adds to hiddenPrs", async () => {
    mockState.followedPrs.add(prUrl);
    setupFollowedTabWithPrs();

    const items = getFocusables();
    const prCardIndex = items.findIndex((el) => el.classList.contains("pr-card"));

    const promise = hideCurrentFocusPr(prCardIndex);
    vi.advanceTimersByTime(400);
    await promise;

    // Must be both unfollowed AND hidden (the bug we fixed)
    expect(mockState.followedPrs.has(prUrl)).toBe(false);
    expect(mockState.hiddenPrs.has(prUrl)).toBe(true);
  });

  it("persists hidden_prs and followed_prs to settings", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    setupFollowedTabWithPrs();

    const items = getFocusables();
    const prCardIndex = items.findIndex((el) => el.classList.contains("pr-card"));

    const promise = hideCurrentFocusPr(prCardIndex);
    vi.advanceTimersByTime(400);
    await promise;

    expect(invoke).toHaveBeenCalledWith("get_settings");
    expect(invoke).toHaveBeenCalledWith("update_settings", expect.objectContaining({
      settings: expect.objectContaining({
        hidden_prs: expect.arrayContaining([{ url: prUrl, title: prTitle }]),
      }),
    }));
  });

  it("adds card-exit-hidden class for animation", async () => {
    setupMineTabWithPrs();
    const card = document.querySelector(".pr-card")!;
    const promise = hideCurrentFocusPr(1);
    expect(card.classList.contains("card-exit-hidden")).toBe(true);
    vi.advanceTimersByTime(400);
    await promise;
  });

  it("removes PR from all result arrays", async () => {
    const pr = makePr({ title: prTitle, url: prUrl });
    mockState.activeTab = "mine";
    mockState.currentResult = makeFetchResult({
      open: [pr],
      recently_merged: [pr],
      recently_closed: [pr],
      followed_open: [pr],
      followed_recently_merged: [pr],
      followed_recently_closed: [pr],
    });
    renderActiveTab();

    const promise = hideCurrentFocusPr(1);
    vi.advanceTimersByTime(400);
    await promise;

    const result = mockState.currentResult!;
    expect(result.open).toHaveLength(0);
    expect(result.recently_merged).toHaveLength(0);
    expect(result.recently_closed).toHaveLength(0);
    expect(result.followed_open).toHaveLength(0);
    expect(result.followed_recently_merged).toHaveLength(0);
    expect(result.followed_recently_closed).toHaveLength(0);
  });
});
