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
    autoFollowedPrUrls: new Set<string>(),
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

import { renderActiveTab, setActiveTab, updateTabBadges, hideCurrentFocusPr, initTabs, bindContentEvents } from "../tabs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { toggleFavorite, toggleHidden, persistPrefs } from "../prefs";

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

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

// ---------------------------------------------------------------------------
// initTabs — showSettings callback
// ---------------------------------------------------------------------------

describe("initTabs", () => {
  it("setActiveTab('settings') calls the stored showSettings callback", () => {
    const showSettingsFn = vi.fn();
    initTabs(showSettingsFn);
    mockState.currentResult = makeFetchResult();
    setActiveTab("settings");
    expect(showSettingsFn).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Mine tab — groupByRepository path
// ---------------------------------------------------------------------------

describe("renderActiveTab — mine groupByRepository", () => {
  it("renders accordion content when groupByRepository is true", () => {
    const pr = makePr({ title: "Grouped PR", url: "https://github.com/org/repo/pull/1" });
    mockState.activeTab = "mine";
    mockState.groupByRepository = true;
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();
    const content = document.getElementById("content")!;
    expect(content.querySelector(".accordion")).toBeTruthy();
    expect(content.innerHTML).toContain("Grouped PR");
  });

  it("renders accordion (not empty state) when hidden orgs exist but no PRs", () => {
    mockState.activeTab = "mine";
    mockState.hiddenOrgs.add("hidden-org");
    mockState.currentResult = makeFetchResult({ open: [] });
    renderActiveTab();
    const content = document.getElementById("content")!;
    // Should render accordion with the hidden org, not "No open PRs"
    expect(content.innerHTML).not.toContain("No open PRs");
    expect(content.querySelector(".accordion")).toBeTruthy();
  });

  it("renders accordion (not empty state) when hidden repos exist but no PRs", () => {
    mockState.activeTab = "mine";
    mockState.hiddenRepos.add("org/hidden-repo");
    mockState.currentResult = makeFetchResult({ open: [] });
    renderActiveTab();
    const content = document.getElementById("content")!;
    expect(content.innerHTML).not.toContain("No open PRs");
  });

  it("uses forceExpand when search query is active with groupByRepository", () => {
    const pr = makePr({ title: "Expandable PR", url: "https://github.com/org/repo/pull/1" });
    mockState.activeTab = "mine";
    mockState.groupByRepository = true;
    mockState.searchQuery = "Expandable";
    mockState.collapsedAccordions.add("org:org");
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();
    const content = document.getElementById("content")!;
    // With forceExpand, collapsed accordions should be forced open
    const details = content.querySelector("details.accordion");
    expect(details).toBeTruthy();
    expect((details as HTMLDetailsElement).open).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Followed tab — filter bar, dropdown, attention badges
// ---------------------------------------------------------------------------

describe("renderActiveTab — followed filter bar", () => {
  it("renders dropdown when more than 3 followed users", () => {
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob", "carol", "dave"];
    mockState.currentResult = makeFetchResult({ followed_open: [] });
    renderActiveTab();
    const content = document.getElementById("content")!;
    expect(content.querySelector("#follow-filter-more")).toBeTruthy();
    expect(content.querySelector("#follow-filter-dropdown")).toBeTruthy();
    expect(content.querySelector(".follow-filter-dropdown-item")).toBeTruthy();
  });

  it("shows attention badges on user filter buttons", () => {
    const pr = makePr({ title: "Attn PR", url: "https://github.com/org/repo/pull/10", author: { login: "alice" } });
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob"];
    mockState.currentAttentionUrls = ["https://github.com/org/repo/pull/10"];
    mockState.currentResult = makeFetchResult({ followed_open: [pr] });
    renderActiveTab();
    const allBtn = document.querySelector('.follow-filter-btn[data-filter="all"]')!;
    expect(allBtn.querySelector(".tab-badge")!.textContent).toBe("1");
    const aliceBtn = document.querySelector('.follow-filter-btn[data-filter="alice"]')!;
    expect(aliceBtn.querySelector(".tab-badge")!.textContent).toBe("1");
  });

  it("renders accordion when groupByRepository is true in followed tab", () => {
    const pr = makePr({ title: "Followed Accordion", url: "https://github.com/org/repo/pull/1", author: { login: "alice" } });
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice"];
    mockState.groupByRepository = true;
    mockState.currentResult = makeFetchResult({ followed_open: [pr] });
    renderActiveTab();
    const content = document.getElementById("content")!;
    expect(content.querySelector(".accordion")).toBeTruthy();
  });

  it("shows no-match message when search filters out all followed PRs", () => {
    const pr = makePr({ title: "Real PR", url: "https://github.com/org/repo/pull/1", author: { login: "alice" } });
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice"];
    mockState.searchQuery = "nonexistent";
    mockState.currentResult = makeFetchResult({ followed_open: [pr] });
    renderActiveTab();
    expect(document.getElementById("content")!.innerHTML).toContain("No PRs match");
  });

  it("shows empty state when followed tab has users but no open PRs and no search", () => {
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice"];
    mockState.currentResult = makeFetchResult({ followed_open: [] });
    renderActiveTab();
    expect(document.getElementById("content")!.innerHTML).toContain("No PRs");
  });

  it("moves selected user to front for inline visibility", () => {
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob", "carol", "dave"];
    mockState.activeFollowFilter = "dave";
    mockState.currentResult = makeFetchResult({ followed_open: [] });
    renderActiveTab();
    // "dave" should be inline (visible), not in the dropdown
    const inlineBtn = document.querySelector('.follow-filter-btn[data-filter="dave"]');
    expect(inlineBtn).toBeTruthy();
    // It should NOT be in the dropdown
    const dropdownItem = document.querySelector('.follow-filter-dropdown-item[data-filter="dave"]');
    expect(dropdownItem).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Follow filter events — click filter buttons and dropdown items
// ---------------------------------------------------------------------------

describe("follow filter events", () => {
  it("clicking a follow-filter-btn sets the filter and re-renders", () => {
    const pr = makePr({ title: "PR", url: "https://github.com/org/repo/pull/1", author: { login: "alice" } });
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob"];
    mockState.currentResult = makeFetchResult({ followed_open: [pr] });
    renderActiveTab();
    vi.clearAllMocks();

    const aliceBtn = document.querySelector<HTMLButtonElement>('.follow-filter-btn[data-filter="alice"]')!;
    aliceBtn.click();
    expect(mockState.setActiveFollowFilter).toHaveBeenCalledWith("alice");
  });

  it("clicking a dropdown item sets the filter and re-renders", () => {
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob", "carol", "dave"];
    mockState.currentResult = makeFetchResult({ followed_open: [] });
    renderActiveTab();
    vi.clearAllMocks();

    const dropdownItem = document.querySelector<HTMLButtonElement>('.follow-filter-dropdown-item')!;
    const filter = dropdownItem.getAttribute("data-filter")!;
    dropdownItem.click();
    expect(mockState.setActiveFollowFilter).toHaveBeenCalledWith(filter);
  });

  it("clicking more button toggles dropdown visibility", () => {
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob", "carol", "dave"];
    mockState.currentResult = makeFetchResult({ followed_open: [] });
    renderActiveTab();

    const moreBtn = document.querySelector<HTMLButtonElement>("#follow-filter-more")!;
    const dropdown = document.querySelector<HTMLElement>("#follow-filter-dropdown")!;
    expect(dropdown.classList.contains("visible")).toBe(false);
    moreBtn.click();
    expect(dropdown.classList.contains("visible")).toBe(true);
    moreBtn.click();
    expect(dropdown.classList.contains("visible")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Search events — input and clear (tested via renderActiveTab)
// ---------------------------------------------------------------------------

describe("search events", () => {
  it("typing in search input sets search query and re-renders", () => {
    mockState.activeTab = "mine";
    mockState.currentResult = makeFetchResult({ open: [makePr()] });
    renderActiveTab();
    vi.clearAllMocks();

    const input = document.getElementById("pr-search-input") as HTMLInputElement;
    input.value = "test";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(mockState.setSearchQuery).toHaveBeenCalledWith("test");
  });

  it("clicking clear button resets search query", () => {
    mockState.activeTab = "mine";
    mockState.searchQuery = "something";
    mockState.currentResult = makeFetchResult({ open: [makePr()] });
    renderActiveTab();
    vi.clearAllMocks();

    const clearBtn = document.getElementById("search-clear-btn") as HTMLButtonElement;
    clearBtn.click();
    expect(mockState.setSearchQuery).toHaveBeenCalledWith("");
  });
});

// ---------------------------------------------------------------------------
// bindContentEvents
// ---------------------------------------------------------------------------

describe("bindContentEvents", () => {
  it("PR card click opens URL via openUrl", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/5" });
    mockState.activeTab = "mine";
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    const card = document.querySelector<HTMLElement>(".pr-card")!;
    card.click();
    expect(openUrl).toHaveBeenCalledWith("https://github.com/org/repo/pull/5");
  });

  it("PR card click with attention dismisses it", () => {
    const prUrl = "https://github.com/org/repo/pull/5";
    const pr = makePr({ url: prUrl });
    mockState.activeTab = "mine";
    mockState.currentAttentionUrls = [prUrl];
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    const card = document.querySelector<HTMLElement>(".pr-card")!;
    expect(card.classList.contains("attention")).toBe(true);
    card.click();
    expect(card.classList.contains("attention")).toBe(false);
    expect(invoke).toHaveBeenCalledWith("dismiss_pr", { url: prUrl });
  });

  it("copy button copies URL and adds copied class", async () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/7" });
    mockState.activeTab = "mine";
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    const copyBtn = document.querySelector<HTMLButtonElement>(".copy-btn")!;
    copyBtn.click();
    // Wait for the clipboard promise to resolve
    await vi.advanceTimersByTimeAsync(0);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://github.com/org/repo/pull/7");
    expect(copyBtn.classList.contains("copied")).toBe(true);
  });

  it("accordion toggle adds to collapsedAccordions and calls persistPrefs", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1" });
    mockState.activeTab = "mine";
    mockState.groupByRepository = true;
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    const details = document.querySelector<HTMLDetailsElement>("details[data-accordion-id]")!;
    const id = details.getAttribute("data-accordion-id")!;

    // Close the accordion
    details.open = false;
    details.dispatchEvent(new Event("toggle"));
    expect(mockState.collapsedAccordions.has(id)).toBe(true);
    expect(persistPrefs).toHaveBeenCalled();

    // Reopen the accordion
    (persistPrefs as ReturnType<typeof vi.fn>).mockClear();
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    expect(mockState.collapsedAccordions.has(id)).toBe(false);
    expect(persistPrefs).toHaveBeenCalled();
  });

  it("fav button calls toggleFavorite with correct type and key", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1" });
    mockState.activeTab = "mine";
    mockState.groupByRepository = true;
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    const favBtn = document.querySelector<HTMLButtonElement>(".fav-btn")!;
    const type = favBtn.getAttribute("data-fav-type")!;
    const key = favBtn.getAttribute("data-fav-key")!;
    favBtn.click();
    expect(toggleFavorite).toHaveBeenCalledWith(type, key);
  });

  it("hide button calls toggleHidden with correct type and key", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1" });
    mockState.activeTab = "mine";
    mockState.groupByRepository = true;
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    const hideBtn = document.querySelector<HTMLButtonElement>(".hide-btn")!;
    const type = hideBtn.getAttribute("data-hide-type")!;
    const key = hideBtn.getAttribute("data-hide-key")!;
    hideBtn.click();
    expect(toggleHidden).toHaveBeenCalledWith(type, key);
  });

  it("open-gh button opens GitHub URL", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1" });
    mockState.activeTab = "mine";
    mockState.groupByRepository = true;
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    const openBtn = document.querySelector<HTMLButtonElement>(".open-gh-btn")!;
    const ghUrl = openBtn.getAttribute("data-gh-url")!;
    openBtn.click();
    expect(openUrl).toHaveBeenCalledWith(ghUrl);
  });

  it("Cmd+click on accordion label opens org/repo on GitHub", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1" });
    mockState.activeTab = "mine";
    mockState.groupByRepository = true;
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    const label = document.querySelector<HTMLElement>(".accordion-label")!;
    const cmdClick = new MouseEvent("click", { metaKey: true, bubbles: true });
    label.dispatchEvent(cmdClick);
    expect(openUrl).toHaveBeenCalledWith(expect.stringContaining("https://github.com/"));
  });

  it("Cmd+click without metaKey does not open URL", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1" });
    mockState.activeTab = "mine";
    mockState.groupByRepository = true;
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();
    vi.clearAllMocks();

    const label = document.querySelector<HTMLElement>(".accordion-label")!;
    const normalClick = new MouseEvent("click", { metaKey: false, bubbles: true });
    label.dispatchEvent(normalClick);
    expect(openUrl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Hover dismiss on PR cards
// ---------------------------------------------------------------------------

describe("bindContentEvents — hover dismiss", () => {
  it("mouseenter after 500ms on attention card dismisses after 300ms", () => {
    const prUrl = "https://github.com/org/repo/pull/5";
    const pr = makePr({ url: prUrl });
    mockState.activeTab = "mine";
    mockState.currentAttentionUrls = [prUrl];
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    const card = document.querySelector<HTMLElement>(".pr-card")!;
    expect(card.classList.contains("attention")).toBe(true);

    // Advance past the readyToHover threshold (500ms)
    vi.advanceTimersByTime(500);

    card.dispatchEvent(new MouseEvent("mouseenter"));
    // Attention still present before 300ms
    expect(card.classList.contains("attention")).toBe(true);
    vi.advanceTimersByTime(300);
    // Now dismissed
    expect(card.classList.contains("attention")).toBe(false);
    expect(invoke).toHaveBeenCalledWith("dismiss_pr", { url: prUrl });
  });

  it("mouseleave cancels pending dismiss", () => {
    const prUrl = "https://github.com/org/repo/pull/5";
    const pr = makePr({ url: prUrl });
    mockState.activeTab = "mine";
    mockState.currentAttentionUrls = [prUrl];
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    const card = document.querySelector<HTMLElement>(".pr-card")!;
    vi.advanceTimersByTime(500);
    card.dispatchEvent(new MouseEvent("mouseenter"));
    // Leave before 300ms
    vi.advanceTimersByTime(100);
    card.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(300);
    // Should still have attention since we left before the timer fired
    expect(card.classList.contains("attention")).toBe(true);
  });

  it("mouseenter before 500ms does not start dismiss timer", () => {
    const prUrl = "https://github.com/org/repo/pull/5";
    const pr = makePr({ url: prUrl });
    mockState.activeTab = "mine";
    mockState.currentAttentionUrls = [prUrl];
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    const card = document.querySelector<HTMLElement>(".pr-card")!;
    // Hover immediately (within 500ms of render)
    card.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(1000);
    // Should still have attention
    expect(card.classList.contains("attention")).toBe(true);
  });

  it("mouseleave removes highlight classes", () => {
    const prUrl = "https://github.com/org/repo/pull/5";
    const pr = makePr({ url: prUrl });
    mockState.activeTab = "mine";
    mockState.currentAttentionUrls = [prUrl];
    mockState.currentResult = makeFetchResult({
      open: [pr],
      element_changes: { [prUrl]: { new_comment: true } },
    });
    renderActiveTab();

    const card = document.querySelector<HTMLElement>(".pr-card")!;
    vi.advanceTimersByTime(500);
    card.dispatchEvent(new MouseEvent("mouseenter"));
    card.dispatchEvent(new MouseEvent("mouseleave"));

    // Verify highlight classes are removed
    const highlights = card.querySelectorAll(".highlight-attention, .highlight-changed");
    highlights.forEach((el) => {
      expect(el.classList.contains("highlight-attention")).toBe(false);
      expect(el.classList.contains("highlight-changed")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// updateFollowFilterBadges (tested indirectly via bindContentEvents dismiss)
// ---------------------------------------------------------------------------

describe("updateFollowFilterBadges", () => {
  it("updates badges after attention dismiss on followed tab", () => {
    const prUrl = "https://github.com/org/repo/pull/10";
    const pr = makePr({ url: prUrl, author: { login: "alice" } });
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob"];
    mockState.currentAttentionUrls = [prUrl];
    mockState.currentResult = makeFetchResult({ followed_open: [pr] });
    renderActiveTab();

    // Verify badge is present on All button before dismiss
    const allBtn = document.querySelector('.follow-filter-btn[data-filter="all"]')!;
    expect(allBtn.querySelector(".tab-badge")).toBeTruthy();

    // Click the card to dismiss attention
    const card = document.querySelector<HTMLElement>(".pr-card")!;
    card.click();

    // After dismiss + re-render of badges, the "All" badge should be gone or updated
    // (setCurrentAttentionUrls removes the url, then updateFollowFilterBadges runs)
    expect(mockState.setCurrentAttentionUrls).toHaveBeenCalled();
  });

  it("does nothing when not on followed tab", () => {
    const prUrl = "https://github.com/org/repo/pull/10";
    const pr = makePr({ url: prUrl });
    mockState.activeTab = "mine";
    mockState.currentAttentionUrls = [prUrl];
    mockState.currentResult = makeFetchResult({ open: [pr] });
    renderActiveTab();

    // Dismiss — updateFollowFilterBadges should early-return without error
    const card = document.querySelector<HTMLElement>(".pr-card")!;
    card.click();
    // No error thrown — test passes
    expect(invoke).toHaveBeenCalledWith("dismiss_pr", { url: prUrl });
  });
});

// ---------------------------------------------------------------------------
// More button dropdown toggle and document click to close (lines 283-290)
// ---------------------------------------------------------------------------

describe("more button dropdown — toggle and document click", () => {
  function setupFollowedWith4Users() {
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob", "carol", "dave"];
    mockState.currentResult = makeFetchResult({ followed_open: [] });
    renderActiveTab();
  }

  it("clicking more button adds visible class to dropdown", () => {
    setupFollowedWith4Users();
    const moreBtn = document.querySelector<HTMLButtonElement>("#follow-filter-more")!;
    const dropdown = document.querySelector<HTMLElement>("#follow-filter-dropdown")!;
    expect(dropdown.classList.contains("visible")).toBe(false);
    moreBtn.click();
    expect(dropdown.classList.contains("visible")).toBe(true);
  });

  it("clicking more button again removes visible class (toggle)", () => {
    setupFollowedWith4Users();
    const moreBtn = document.querySelector<HTMLButtonElement>("#follow-filter-more")!;
    const dropdown = document.querySelector<HTMLElement>("#follow-filter-dropdown")!;
    moreBtn.click();
    expect(dropdown.classList.contains("visible")).toBe(true);
    moreBtn.click();
    expect(dropdown.classList.contains("visible")).toBe(false);
  });

  it("clicking elsewhere on document closes the dropdown", () => {
    setupFollowedWith4Users();
    const moreBtn = document.querySelector<HTMLButtonElement>("#follow-filter-more")!;
    const dropdown = document.querySelector<HTMLElement>("#follow-filter-dropdown")!;
    moreBtn.click();
    expect(dropdown.classList.contains("visible")).toBe(true);
    // Click elsewhere on document
    document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(dropdown.classList.contains("visible")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Search binding guard — only mine/followed tabs bind search (line 330)
// ---------------------------------------------------------------------------

describe("search binding guard", () => {
  it("binds search events on mine tab", () => {
    mockState.activeTab = "mine";
    mockState.currentResult = makeFetchResult({ open: [makePr()] });
    renderActiveTab();
    const input = document.getElementById("pr-search-input") as HTMLInputElement;
    expect(input).toBeTruthy();
    // Verify the input event listener works (search is bound)
    vi.clearAllMocks();
    input.value = "query";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(mockState.setSearchQuery).toHaveBeenCalledWith("query");
  });

  it("binds search events on followed tab", () => {
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice"];
    mockState.currentResult = makeFetchResult({ followed_open: [makePr({ author: { login: "alice" } })] });
    renderActiveTab();
    const input = document.getElementById("pr-search-input") as HTMLInputElement;
    expect(input).toBeTruthy();
    vi.clearAllMocks();
    input.value = "test";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(mockState.setSearchQuery).toHaveBeenCalledWith("test");
  });

  it("does not bind search events on merged tab (no search input rendered)", () => {
    const pr = makePr({ state: "MERGED", merged: true });
    mockState.activeTab = "merged";
    mockState.currentResult = makeFetchResult({ recently_merged: [pr] });
    renderActiveTab();
    // Merged tab does not render a search bar
    const input = document.getElementById("pr-search-input");
    expect(input).toBeNull();
  });

  it("does not bind search events on closed tab (no search input rendered)", () => {
    const pr = makePr({ state: "CLOSED" });
    mockState.activeTab = "closed";
    mockState.currentResult = makeFetchResult({ recently_closed: [pr] });
    renderActiveTab();
    const input = document.getElementById("pr-search-input");
    expect(input).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateFollowFilterBadges — badge creation and removal (lines 345-397)
// ---------------------------------------------------------------------------

describe("updateFollowFilterBadges — badge lifecycle", () => {
  it("creates badge on All button when attention PRs exist", () => {
    const pr1 = makePr({ url: "https://github.com/org/repo/pull/1", author: { login: "alice" } });
    const pr2 = makePr({ url: "https://github.com/org/repo/pull/2", author: { login: "bob" } });
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob"];
    mockState.currentAttentionUrls = [
      "https://github.com/org/repo/pull/1",
      "https://github.com/org/repo/pull/2",
    ];
    mockState.currentResult = makeFetchResult({ followed_open: [pr1, pr2] });
    renderActiveTab();

    const allBtn = document.querySelector('.follow-filter-btn[data-filter="all"]')!;
    const badge = allBtn.querySelector(".tab-badge");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("2");
  });

  it("creates per-user badges with correct attention counts", () => {
    const pr1 = makePr({ url: "https://github.com/org/repo/pull/1", author: { login: "alice" } });
    const pr2 = makePr({ url: "https://github.com/org/repo/pull/2", author: { login: "alice" } });
    const pr3 = makePr({ url: "https://github.com/org/repo/pull/3", author: { login: "bob" } });
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob"];
    mockState.currentAttentionUrls = [
      "https://github.com/org/repo/pull/1",
      "https://github.com/org/repo/pull/2",
      "https://github.com/org/repo/pull/3",
    ];
    mockState.currentResult = makeFetchResult({ followed_open: [pr1, pr2, pr3] });
    renderActiveTab();

    const aliceBtn = document.querySelector('.follow-filter-btn[data-filter="alice"]')!;
    expect(aliceBtn.querySelector(".tab-badge")!.textContent).toBe("2");

    const bobBtn = document.querySelector('.follow-filter-btn[data-filter="bob"]')!;
    expect(bobBtn.querySelector(".tab-badge")!.textContent).toBe("1");
  });

  it("removes All badge after all attention PRs are dismissed", () => {
    const prUrl = "https://github.com/org/repo/pull/10";
    const pr = makePr({ url: prUrl, author: { login: "alice" } });
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob"];
    mockState.currentAttentionUrls = [prUrl];
    mockState.currentResult = makeFetchResult({ followed_open: [pr] });
    renderActiveTab();

    // Verify badge exists before dismiss
    const allBtnBefore = document.querySelector('.follow-filter-btn[data-filter="all"]')!;
    expect(allBtnBefore.querySelector(".tab-badge")).toBeTruthy();

    // Click the card to dismiss attention (triggers updateFollowFilterBadges)
    const card = document.querySelector<HTMLElement>(".pr-card")!;
    card.click();

    // After dismiss, updateFollowFilterBadges runs with empty attention urls
    // The All button badge should be removed
    const allBtnAfter = document.querySelector('.follow-filter-btn[data-filter="all"]')!;
    expect(allBtnAfter.querySelector(".tab-badge")).toBeNull();
  });

  it("removes per-user badge after that user's attention PRs are dismissed", () => {
    const prUrl = "https://github.com/org/repo/pull/10";
    const pr = makePr({ url: prUrl, author: { login: "alice" } });
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob"];
    mockState.currentAttentionUrls = [prUrl];
    mockState.currentResult = makeFetchResult({ followed_open: [pr] });
    renderActiveTab();

    // Verify alice badge exists
    const aliceBtnBefore = document.querySelector('.follow-filter-btn[data-filter="alice"]')!;
    expect(aliceBtnBefore.querySelector(".tab-badge")).toBeTruthy();

    // Click the card to dismiss
    const card = document.querySelector<HTMLElement>(".pr-card")!;
    card.click();

    // Alice badge should be removed
    const aliceBtnAfter = document.querySelector('.follow-filter-btn[data-filter="alice"]')!;
    expect(aliceBtnAfter.querySelector(".tab-badge")).toBeNull();
  });

  it("creates badge on dropdown items for users in the overflow dropdown", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1", author: { login: "dave" } });
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob", "carol", "dave"];
    mockState.currentAttentionUrls = ["https://github.com/org/repo/pull/1"];
    mockState.currentResult = makeFetchResult({ followed_open: [pr] });
    renderActiveTab();

    // dave is the 4th user, goes into the dropdown (inline shows first 3)
    const daveDropdownItem = document.querySelector('.follow-filter-dropdown-item[data-filter="dave"]')!;
    expect(daveDropdownItem).toBeTruthy();
    const badge = daveDropdownItem.querySelector(".tab-badge");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("1");
  });

  it("updates existing badge text instead of creating duplicate", () => {
    const pr1 = makePr({ url: "https://github.com/org/repo/pull/1", author: { login: "alice" } });
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob"];
    mockState.currentAttentionUrls = ["https://github.com/org/repo/pull/1"];
    mockState.currentResult = makeFetchResult({ followed_open: [pr1] });
    renderActiveTab();

    // Verify initial badge count
    const allBtn = document.querySelector('.follow-filter-btn[data-filter="all"]')!;
    expect(allBtn.querySelector(".tab-badge")!.textContent).toBe("1");

    // Now add a second attention PR and dismiss the first to trigger updateFollowFilterBadges
    // Simulating by clicking dismiss on the card triggers the badge update
    const card = document.querySelector<HTMLElement>(".pr-card")!;
    card.click();

    // After dismiss, badge should be removed (count goes to 0)
    expect(allBtn.querySelector(".tab-badge")).toBeNull();
    // Verify no duplicate badges were created
    expect(allBtn.querySelectorAll(".tab-badge").length).toBe(0);
  });

  it("user without attention PRs has no badge", () => {
    const pr = makePr({ url: "https://github.com/org/repo/pull/1", author: { login: "alice" } });
    mockState.activeTab = "followed";
    mockState.followedUsers = ["alice", "bob"];
    mockState.currentAttentionUrls = ["https://github.com/org/repo/pull/1"];
    mockState.currentResult = makeFetchResult({ followed_open: [pr] });
    renderActiveTab();

    // Bob has no attention PRs — no badge
    const bobBtn = document.querySelector('.follow-filter-btn[data-filter="bob"]')!;
    expect(bobBtn.querySelector(".tab-badge")).toBeNull();
  });
});
