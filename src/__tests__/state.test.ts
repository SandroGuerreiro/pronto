import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_KEYBINDINGS } from "../types";
import type { FetchResult, TabName } from "../types";

import {
  currentAttentionUrls,
  setCurrentAttentionUrls,
  currentResult,
  setCurrentResult,
  activeTab,
  setActiveTabState,
  activeFollowFilter,
  setActiveFollowFilter,
  showAuthorInCards,
  setShowAuthorInCards,
  groupByRepository,
  setGroupByRepository,
  showRecentlyMerged,
  setShowRecentlyMerged,
  showClosed,
  setShowClosed,
  focusIndex,
  setFocusIndex,
  sidebarFocus,
  setSidebarFocus,
  popoverFocusIndex,
  setPopoverFocusIndex,
  settingsNavIndex,
  setSettingsNavIndex,
  settingsGroupIndex,
  setSettingsGroupIndex,
  releaseNotesOpen,
  setReleaseNotesOpen,
  releaseNotesIndex,
  setReleaseNotesIndex,
  kbDismissTimer,
  setKbDismissTimer,
  lastWorkflowConclusion,
  setLastWorkflowConclusion,
  workflowHasAttention,
  setWorkflowHasAttention,
  followedUsers,
  setFollowedUsers,
  viewerLogin,
  setViewerLogin,
  searchQuery,
  setSearchQuery,
  favoriteOrgs,
  favoriteRepos,
  collapsedAccordions,
  hiddenOrgs,
  hiddenRepos,
  hiddenPrs,
  followedPrs,
  pendingUnhideOrgs,
  pendingUnhideRepos,
  clearPendingUnhide,
  keybindings,
  setKeybindings,
} from "../state";

// ---------------------------------------------------------------------------
// Helper: We re-import state as a namespace so we can read live bindings
// after setter calls (direct named imports capture the initial value for
// primitives, but namespace access always reflects the latest binding).
// ---------------------------------------------------------------------------
import * as state from "../state";

// ---------------------------------------------------------------------------
// Reset helpers — restore every piece of state to its initial value so tests
// are fully isolated.
// ---------------------------------------------------------------------------
function resetState(): void {
  setCurrentAttentionUrls([]);
  setCurrentResult(null);
  setActiveTabState("mine");
  setActiveFollowFilter("all");
  setShowAuthorInCards(false);
  setGroupByRepository(true);
  setShowRecentlyMerged(false);
  setShowClosed(false);
  setFocusIndex(-1);
  setSidebarFocus(null);
  setPopoverFocusIndex(-1);
  setSettingsNavIndex(0);
  setSettingsGroupIndex(-1);
  setReleaseNotesOpen(false);
  setReleaseNotesIndex(0);
  setKbDismissTimer(null);
  setLastWorkflowConclusion(null);
  setWorkflowHasAttention(false);
  setFollowedUsers([]);
  setViewerLogin("");
  setSearchQuery("");
  setKeybindings({});

  // Clear mutable collections
  favoriteOrgs.clear();
  favoriteRepos.clear();
  collapsedAccordions.clear();
  hiddenOrgs.clear();
  hiddenRepos.clear();
  hiddenPrs.clear();
  followedPrs.clear();
  pendingUnhideOrgs.clear();
  pendingUnhideRepos.clear();
}

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

describe("state — default values", () => {
  beforeEach(resetState);

  it("currentAttentionUrls defaults to empty array", () => {
    expect(state.currentAttentionUrls).toEqual([]);
  });

  it("currentResult defaults to null", () => {
    expect(state.currentResult).toBeNull();
  });

  it("activeTab defaults to 'mine'", () => {
    expect(state.activeTab).toBe("mine");
  });

  it("activeFollowFilter defaults to 'all'", () => {
    expect(state.activeFollowFilter).toBe("all");
  });

  it("showAuthorInCards defaults to false", () => {
    expect(state.showAuthorInCards).toBe(false);
  });

  it("groupByRepository defaults to true", () => {
    expect(state.groupByRepository).toBe(true);
  });

  it("showRecentlyMerged defaults to false", () => {
    expect(state.showRecentlyMerged).toBe(false);
  });

  it("showClosed defaults to false", () => {
    expect(state.showClosed).toBe(false);
  });

  it("focusIndex defaults to -1", () => {
    expect(state.focusIndex).toBe(-1);
  });

  it("sidebarFocus defaults to null", () => {
    expect(state.sidebarFocus).toBeNull();
  });

  it("popoverFocusIndex defaults to -1", () => {
    expect(state.popoverFocusIndex).toBe(-1);
  });

  it("settingsNavIndex defaults to 0", () => {
    expect(state.settingsNavIndex).toBe(0);
  });

  it("settingsGroupIndex defaults to -1", () => {
    expect(state.settingsGroupIndex).toBe(-1);
  });

  it("releaseNotesOpen defaults to false", () => {
    expect(state.releaseNotesOpen).toBe(false);
  });

  it("releaseNotesIndex defaults to 0", () => {
    expect(state.releaseNotesIndex).toBe(0);
  });

  it("kbDismissTimer defaults to null", () => {
    expect(state.kbDismissTimer).toBeNull();
  });

  it("lastWorkflowConclusion defaults to null", () => {
    expect(state.lastWorkflowConclusion).toBeNull();
  });

  it("workflowHasAttention defaults to false", () => {
    expect(state.workflowHasAttention).toBe(false);
  });

  it("followedUsers defaults to empty array", () => {
    expect(state.followedUsers).toEqual([]);
  });

  it("viewerLogin defaults to empty string", () => {
    expect(state.viewerLogin).toBe("");
  });

  it("searchQuery defaults to empty string", () => {
    expect(state.searchQuery).toBe("");
  });

  it("keybindings defaults to DEFAULT_KEYBINDINGS", () => {
    expect(state.keybindings).toEqual(DEFAULT_KEYBINDINGS);
  });

  it("Sets default to empty", () => {
    expect(state.favoriteOrgs.size).toBe(0);
    expect(state.favoriteRepos.size).toBe(0);
    expect(state.collapsedAccordions.size).toBe(0);
    expect(state.hiddenOrgs.size).toBe(0);
    expect(state.hiddenRepos.size).toBe(0);
    expect(state.followedPrs.size).toBe(0);
    expect(state.pendingUnhideOrgs.size).toBe(0);
    expect(state.pendingUnhideRepos.size).toBe(0);
  });

  it("hiddenPrs Map defaults to empty", () => {
    expect(state.hiddenPrs.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Primitive setters
// ---------------------------------------------------------------------------

describe("state — primitive setters", () => {
  beforeEach(resetState);

  it("setCurrentAttentionUrls updates currentAttentionUrls", () => {
    const urls = ["https://github.com/org/repo/pull/1", "https://github.com/org/repo/pull/2"];
    setCurrentAttentionUrls(urls);
    expect(state.currentAttentionUrls).toEqual(urls);
  });

  it("setCurrentAttentionUrls with empty array", () => {
    setCurrentAttentionUrls(["a"]);
    setCurrentAttentionUrls([]);
    expect(state.currentAttentionUrls).toEqual([]);
  });

  it("setCurrentResult updates currentResult", () => {
    const result = {
      owned_prs: [],
      followed_prs: [],
      merged_prs: [],
      closed_prs: [],
      viewer_login: "testuser",
      avatar_url: "https://example.com/avatar.png",
    } as FetchResult;
    setCurrentResult(result);
    expect(state.currentResult).toBe(result);
  });

  it("setCurrentResult can set to null", () => {
    const result = {
      owned_prs: [],
      followed_prs: [],
      merged_prs: [],
      closed_prs: [],
      viewer_login: "testuser",
      avatar_url: "",
    } as FetchResult;
    setCurrentResult(result);
    setCurrentResult(null);
    expect(state.currentResult).toBeNull();
  });

  it("setActiveTabState updates activeTab", () => {
    const tabs: TabName[] = ["mine", "followed", "merged", "closed", "settings"];
    for (const tab of tabs) {
      setActiveTabState(tab);
      expect(state.activeTab).toBe(tab);
    }
  });

  it("setActiveFollowFilter updates activeFollowFilter", () => {
    setActiveFollowFilter("octocat");
    expect(state.activeFollowFilter).toBe("octocat");
  });

  it("setShowAuthorInCards updates showAuthorInCards", () => {
    setShowAuthorInCards(true);
    expect(state.showAuthorInCards).toBe(true);
    setShowAuthorInCards(false);
    expect(state.showAuthorInCards).toBe(false);
  });

  it("setGroupByRepository updates groupByRepository", () => {
    setGroupByRepository(false);
    expect(state.groupByRepository).toBe(false);
    setGroupByRepository(true);
    expect(state.groupByRepository).toBe(true);
  });

  it("setShowRecentlyMerged updates showRecentlyMerged", () => {
    setShowRecentlyMerged(true);
    expect(state.showRecentlyMerged).toBe(true);
  });

  it("setShowClosed updates showClosed", () => {
    setShowClosed(true);
    expect(state.showClosed).toBe(true);
  });

  it("setFocusIndex updates focusIndex", () => {
    setFocusIndex(5);
    expect(state.focusIndex).toBe(5);
  });

  it("setFocusIndex accepts negative values", () => {
    setFocusIndex(-1);
    expect(state.focusIndex).toBe(-1);
  });

  it("setSidebarFocus updates sidebarFocus", () => {
    setSidebarFocus("avatar");
    expect(state.sidebarFocus).toBe("avatar");
    setSidebarFocus("quit");
    expect(state.sidebarFocus).toBe("quit");
    setSidebarFocus(null);
    expect(state.sidebarFocus).toBeNull();
  });

  it("setPopoverFocusIndex updates popoverFocusIndex", () => {
    setPopoverFocusIndex(3);
    expect(state.popoverFocusIndex).toBe(3);
  });

  it("setSettingsNavIndex updates settingsNavIndex", () => {
    setSettingsNavIndex(2);
    expect(state.settingsNavIndex).toBe(2);
  });

  it("setSettingsGroupIndex updates settingsGroupIndex", () => {
    setSettingsGroupIndex(4);
    expect(state.settingsGroupIndex).toBe(4);
  });

  it("setReleaseNotesOpen updates releaseNotesOpen", () => {
    setReleaseNotesOpen(true);
    expect(state.releaseNotesOpen).toBe(true);
  });

  it("setReleaseNotesIndex updates releaseNotesIndex", () => {
    setReleaseNotesIndex(7);
    expect(state.releaseNotesIndex).toBe(7);
  });

  it("setKbDismissTimer updates kbDismissTimer", () => {
    const timer = setTimeout(() => {}, 100);
    setKbDismissTimer(timer);
    expect(state.kbDismissTimer).toBe(timer);
    clearTimeout(timer);
  });

  it("setKbDismissTimer can set to null", () => {
    const timer = setTimeout(() => {}, 100);
    setKbDismissTimer(timer);
    setKbDismissTimer(null);
    expect(state.kbDismissTimer).toBeNull();
    clearTimeout(timer);
  });

  it("setLastWorkflowConclusion updates lastWorkflowConclusion", () => {
    setLastWorkflowConclusion("success");
    expect(state.lastWorkflowConclusion).toBe("success");
  });

  it("setLastWorkflowConclusion can set to null", () => {
    setLastWorkflowConclusion("failure");
    setLastWorkflowConclusion(null);
    expect(state.lastWorkflowConclusion).toBeNull();
  });

  it("setWorkflowHasAttention updates workflowHasAttention", () => {
    setWorkflowHasAttention(true);
    expect(state.workflowHasAttention).toBe(true);
  });

  it("setFollowedUsers updates followedUsers", () => {
    const users = ["alice", "bob"];
    setFollowedUsers(users);
    expect(state.followedUsers).toEqual(users);
  });

  it("setFollowedUsers replaces previous value", () => {
    setFollowedUsers(["alice"]);
    setFollowedUsers(["bob", "charlie"]);
    expect(state.followedUsers).toEqual(["bob", "charlie"]);
  });

  it("setViewerLogin updates viewerLogin", () => {
    setViewerLogin("octocat");
    expect(state.viewerLogin).toBe("octocat");
  });

  it("setSearchQuery updates searchQuery", () => {
    setSearchQuery("fix bug");
    expect(state.searchQuery).toBe("fix bug");
  });

  it("setSearchQuery can set to empty string", () => {
    setSearchQuery("something");
    setSearchQuery("");
    expect(state.searchQuery).toBe("");
  });
});

// ---------------------------------------------------------------------------
// clearPendingUnhide
// ---------------------------------------------------------------------------

describe("clearPendingUnhide", () => {
  beforeEach(resetState);

  it("clears both pendingUnhideOrgs and pendingUnhideRepos", () => {
    pendingUnhideOrgs.add("org-a");
    pendingUnhideOrgs.add("org-b");
    pendingUnhideRepos.add("org-a/repo-1");

    clearPendingUnhide();

    expect(state.pendingUnhideOrgs.size).toBe(0);
    expect(state.pendingUnhideRepos.size).toBe(0);
  });

  it("is safe to call when sets are already empty", () => {
    clearPendingUnhide();
    expect(state.pendingUnhideOrgs.size).toBe(0);
    expect(state.pendingUnhideRepos.size).toBe(0);
  });

  it("does not affect other Sets", () => {
    hiddenOrgs.add("org-x");
    hiddenRepos.add("org-x/repo-y");
    pendingUnhideOrgs.add("org-a");

    clearPendingUnhide();

    expect(state.hiddenOrgs.size).toBe(1);
    expect(state.hiddenRepos.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// setKeybindings
// ---------------------------------------------------------------------------

describe("setKeybindings", () => {
  beforeEach(resetState);

  it("returns DEFAULT_KEYBINDINGS when called with empty object", () => {
    setKeybindings({});
    expect(state.keybindings).toEqual(DEFAULT_KEYBINDINGS);
  });

  it("merges partial overrides with defaults", () => {
    setKeybindings({ navigate_down: "ArrowDown" });

    expect(state.keybindings.navigate_down).toBe("ArrowDown");
    // Other defaults preserved
    expect(state.keybindings.navigate_up).toBe(DEFAULT_KEYBINDINGS.navigate_up);
    expect(state.keybindings.expand).toBe(DEFAULT_KEYBINDINGS.expand);
    expect(state.keybindings.collapse).toBe(DEFAULT_KEYBINDINGS.collapse);
    expect(state.keybindings.open_pr).toBe(DEFAULT_KEYBINDINGS.open_pr);
  });

  it("overrides multiple keys while preserving the rest", () => {
    setKeybindings({
      navigate_down: "ArrowDown",
      navigate_up: "ArrowUp",
      expand: "ArrowRight",
      collapse: "ArrowLeft",
    });

    expect(state.keybindings.navigate_down).toBe("ArrowDown");
    expect(state.keybindings.navigate_up).toBe("ArrowUp");
    expect(state.keybindings.expand).toBe("ArrowRight");
    expect(state.keybindings.collapse).toBe("ArrowLeft");
    // Unmodified keys
    expect(state.keybindings.open_pr).toBe(DEFAULT_KEYBINDINGS.open_pr);
    expect(state.keybindings.hide_pr).toBe(DEFAULT_KEYBINDINGS.hide_pr);
    expect(state.keybindings.tab_owned).toBe(DEFAULT_KEYBINDINGS.tab_owned);
    expect(state.keybindings.tab_followed).toBe(DEFAULT_KEYBINDINGS.tab_followed);
    expect(state.keybindings.tab_merged).toBe(DEFAULT_KEYBINDINGS.tab_merged);
    expect(state.keybindings.tab_closed).toBe(DEFAULT_KEYBINDINGS.tab_closed);
  });

  it("allows adding keys not in defaults", () => {
    setKeybindings({ custom_action: "x" });

    expect(state.keybindings.custom_action).toBe("x");
    // Defaults still present
    expect(state.keybindings.navigate_down).toBe(DEFAULT_KEYBINDINGS.navigate_down);
  });

  it("successive calls replace previous overrides", () => {
    setKeybindings({ navigate_down: "ArrowDown" });
    setKeybindings({ navigate_down: "s" });

    expect(state.keybindings.navigate_down).toBe("s");
  });

  it("successive calls do not accumulate custom keys", () => {
    setKeybindings({ custom_a: "a" });
    setKeybindings({ custom_b: "b" });

    // custom_a should be gone because setKeybindings spreads defaults + new
    expect(state.keybindings.custom_a).toBeUndefined();
    expect(state.keybindings.custom_b).toBe("b");
  });

  it("produces a new object reference on each call", () => {
    setKeybindings({});
    const first = state.keybindings;
    setKeybindings({});
    const second = state.keybindings;

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});

// ---------------------------------------------------------------------------
// Mutable collections (Sets and Maps)
// ---------------------------------------------------------------------------

describe("state — mutable collections", () => {
  beforeEach(resetState);

  it("favoriteOrgs can be mutated directly", () => {
    favoriteOrgs.add("my-org");
    expect(state.favoriteOrgs.has("my-org")).toBe(true);
    favoriteOrgs.delete("my-org");
    expect(state.favoriteOrgs.has("my-org")).toBe(false);
  });

  it("favoriteRepos can be mutated directly", () => {
    favoriteRepos.add("my-org/my-repo");
    expect(state.favoriteRepos.has("my-org/my-repo")).toBe(true);
  });

  it("collapsedAccordions can be mutated directly", () => {
    collapsedAccordions.add("section-1");
    collapsedAccordions.add("section-2");
    expect(state.collapsedAccordions.size).toBe(2);
  });

  it("hiddenOrgs can be mutated directly", () => {
    hiddenOrgs.add("secret-org");
    expect(state.hiddenOrgs.has("secret-org")).toBe(true);
  });

  it("hiddenRepos can be mutated directly", () => {
    hiddenRepos.add("org/repo");
    expect(state.hiddenRepos.has("org/repo")).toBe(true);
  });

  it("hiddenPrs Map can be mutated directly", () => {
    hiddenPrs.set("https://github.com/org/repo/pull/1", "Fix typo");
    expect(state.hiddenPrs.get("https://github.com/org/repo/pull/1")).toBe("Fix typo");
    expect(state.hiddenPrs.size).toBe(1);
  });

  it("followedPrs can be mutated directly", () => {
    followedPrs.add("https://github.com/org/repo/pull/42");
    expect(state.followedPrs.has("https://github.com/org/repo/pull/42")).toBe(true);
  });

  it("pendingUnhideOrgs can be mutated directly", () => {
    pendingUnhideOrgs.add("org-a");
    expect(state.pendingUnhideOrgs.has("org-a")).toBe(true);
  });

  it("pendingUnhideRepos can be mutated directly", () => {
    pendingUnhideRepos.add("org-a/repo-1");
    expect(state.pendingUnhideRepos.has("org-a/repo-1")).toBe(true);
  });
});
