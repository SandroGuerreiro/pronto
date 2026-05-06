import type { FetchResult, TabName } from "./types";
import { DEFAULT_KEYBINDINGS } from "./types";

// ── PR data ──────────────────────────────────────────────────────────────────
export let currentAttentionUrls: string[] = [];
export let currentResult: FetchResult | null = null;

// ── UI state ─────────────────────────────────────────────────────────────────
export let activeTab: TabName = "mine";
export let activeFollowFilter: string = "all";
export let showAuthorInCards: boolean = false;
export let groupByRepository: boolean = true;
export let showRecentlyMerged: boolean = false;
export let showClosed: boolean = false;
export let showRequests: boolean = true;
export let focusIndex: number = -1;
export let sidebarFocus: "avatar" | "quit" | null = null;
export let popoverFocusIndex: number = -1;
export let settingsNavIndex: number = 0;
export let settingsGroupIndex: number = -1;
export let releaseNotesOpen: boolean = false;
export let releaseNotesIndex: number = 0;

// ── Keyboard ──────────────────────────────────────────────────────────────────
export let kbDismissTimer: ReturnType<typeof setTimeout> | null = null;

// ── Workflow ──────────────────────────────────────────────────────────────────
export let lastWorkflowConclusion: string | null = null;
export let workflowHasAttention: boolean = false;

// ── Preferences (loaded from Rust) ────────────────────────────────────────────
export let favoriteOrgs = new Set<string>();
export let favoriteRepos = new Set<string>();
export let collapsedAccordions = new Set<string>();
export let hiddenOrgs = new Set<string>();
export let hiddenRepos = new Set<string>();
export let hiddenPrs = new Map<string, string>();
export let followedUsers: string[] = [];
export let followedPrs = new Set<string>();
export let pendingUnhideOrgs = new Set<string>();
export let pendingUnhideRepos = new Set<string>();

// ── Auth ─────────────────────────────────────────────────────────────────────
export let isAuthenticated: boolean = false;

// ── Viewer (logged-in user) ──────────────────────────────────────────────────
export let viewerLogin: string = "";

// ── Search / filter (session-only, never persisted) ───────────────────────────
export let searchQuery: string = "";

// ── Auto-followed PRs (session-only highlight, cleared on focus/click) ─────────
export const autoFollowedPrUrls = new Set<string>();

// ── Unseen review requests (session-only highlight, cleared on hover) ────────
export const unseenRequestUrls = new Set<string>();
export function addUnseenRequestUrl(url: string) { unseenRequestUrls.add(url); }
export function removeUnseenRequestUrl(url: string) { unseenRequestUrls.delete(url); }

// ── Setters ───────────────────────────────────────────────────────────────────
export function setCurrentAttentionUrls(urls: string[]) { currentAttentionUrls = urls; }
export function setCurrentResult(r: FetchResult | null) { currentResult = r; }
export function setActiveTabState(tab: TabName) { activeTab = tab; }
export function setActiveFollowFilter(f: string) { activeFollowFilter = f; }
export function setShowAuthorInCards(v: boolean) { showAuthorInCards = v; }
export function setGroupByRepository(v: boolean) { groupByRepository = v; }
export function setShowRecentlyMerged(v: boolean) { showRecentlyMerged = v; }
export function setShowClosed(v: boolean) { showClosed = v; }
export function setShowRequests(v: boolean) { showRequests = v; }
export function setFocusIndex(i: number) { focusIndex = i; }
export function setSidebarFocus(v: "avatar" | "quit" | null) { sidebarFocus = v; }
export function setPopoverFocusIndex(i: number) { popoverFocusIndex = i; }
export function setSettingsNavIndex(i: number) { settingsNavIndex = i; }
export function setSettingsGroupIndex(i: number) { settingsGroupIndex = i; }
export function setReleaseNotesOpen(v: boolean) { releaseNotesOpen = v; }
export function setReleaseNotesIndex(i: number) { releaseNotesIndex = i; }
export function setKbDismissTimer(t: ReturnType<typeof setTimeout> | null) { kbDismissTimer = t; }
export function setLastWorkflowConclusion(s: string | null) { lastWorkflowConclusion = s; }
export function setWorkflowHasAttention(v: boolean) { workflowHasAttention = v; }
export function setFollowedUsers(users: string[]) { followedUsers = users; }
export function setIsAuthenticated(v: boolean) { isAuthenticated = v; }
export function setViewerLogin(v: string) { viewerLogin = v; }
export function setSearchQuery(q: string) { searchQuery = q; }
export function clearPendingUnhide() {
  pendingUnhideOrgs.clear();
  pendingUnhideRepos.clear();
}

// ── Keybindings ────────────────────────────────────────────────────────────
export let keybindings: Record<string, string> = { ...DEFAULT_KEYBINDINGS };
export function setKeybindings(kb: Record<string, string>) {
  keybindings = { ...DEFAULT_KEYBINDINGS, ...kb };
}
