import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Settings } from "../types";

// ---------------------------------------------------------------------------
// Mocks — vi.mock is hoisted, so use vi.hoisted for shared state
// ---------------------------------------------------------------------------

const { mockState, mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  const mockState = {
    favoriteOrgs: new Set<string>(),
    favoriteRepos: new Set<string>(),
    collapsedAccordions: new Set<string>(),
    hiddenOrgs: new Set<string>(),
    hiddenRepos: new Set<string>(),
    hiddenPrs: new Map<string, string>(),
    followedPrs: new Set<string>(),
    activeFollowFilter: "all",
    groupByRepository: true,
    followedUsers: [] as string[],
    setGroupByRepository: vi.fn((v: boolean) => { mockState.groupByRepository = v; }),
    setFollowedUsers: vi.fn((users: string[]) => { mockState.followedUsers = users; }),
    setActiveFollowFilter: vi.fn((f: string) => { mockState.activeFollowFilter = f; }),
  };
  return { mockState, mockInvoke };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("../state", () => mockState);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    poll_interval_secs: 120,
    notifications_enabled: true,
    show_recently_merged: true,
    merged_window_hours: 24,
    show_closed: false,
    closed_window_hours: 24,
    favorite_orgs: [],
    favorite_repos: [],
    collapsed_accordions: [],
    hidden_orgs: [],
    hidden_repos: [],
    hidden_prs: [],
    followed_users: [],
    followed_prs: [],
    group_by_repository: true,
    workflow_monitor_enabled: false,
    workflow_org: "",
    workflow_repo: "",
    workflow_name: "",
    notification_prefs_owned: {
      review_required: true,
      changes_requested: true,
      approved: true,
      checks_failed: true,
      checks_recovered: true,
      kicked_from_queue: true,
      new_comment: true,
      new_comment_participated: true,
    },
    notification_prefs_followed: {
      review_required: true,
      changes_requested: true,
      approved: true,
      checks_failed: true,
      checks_recovered: true,
      kicked_from_queue: true,
      new_comment: true,
      new_comment_participated: true,
    },
    notify_on_merged: true,
    notify_on_closed: false,
    homebrew_check_enabled: false,
    homebrew_check_interval_secs: 3600,
    notification_sound: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("prefs", () => {
  let prefs: typeof import("../prefs");

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Reset mock state
    mockState.favoriteOrgs.clear();
    mockState.favoriteRepos.clear();
    mockState.collapsedAccordions.clear();
    mockState.hiddenOrgs.clear();
    mockState.hiddenRepos.clear();
    mockState.hiddenPrs.clear();
    mockState.followedPrs.clear();
    mockState.activeFollowFilter = "all";
    mockState.groupByRepository = true;
    mockState.followedUsers = [];

    // Fresh import each test to reset module-level _savePending / callbacks
    vi.resetModules();
    prefs = await import("../prefs");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── initPrefs ───────────────────────────────────────────────────────────────

  describe("initPrefs", () => {
    it("sets onRender and onReload callbacks used by other functions", async () => {
      const onRender = vi.fn();
      const onReload = vi.fn();
      prefs.initPrefs(onRender, onReload);

      // toggleFavorite calls _onRender
      mockInvoke.mockResolvedValue(makeSettings());
      prefs.toggleFavorite("org", "my-org");
      expect(onRender).toHaveBeenCalledOnce();
    });
  });

  // ── loadUserPrefs ──────────────────────────────────────────────────────────

  describe("loadUserPrefs", () => {
    it("populates all state Sets/Maps from settings", async () => {
      const settings = makeSettings({
        favorite_orgs: ["org-a", "org-b"],
        favorite_repos: ["repo-x"],
        collapsed_accordions: ["section-1"],
        hidden_orgs: ["hidden-org"],
        hidden_repos: ["hidden-repo"],
        hidden_prs: [
          { url: "https://github.com/o/r/pull/1", title: "PR one" },
          { url: "https://github.com/o/r/pull/2", title: "PR two" },
        ],
        followed_prs: ["https://github.com/o/r/pull/10"],
        followed_users: ["alice", "bob"],
        group_by_repository: false,
      });
      mockInvoke.mockResolvedValue(settings);

      await prefs.loadUserPrefs();

      expect(mockState.favoriteOrgs).toEqual(new Set(["org-a", "org-b"]));
      expect(mockState.favoriteRepos).toEqual(new Set(["repo-x"]));
      expect(mockState.collapsedAccordions).toEqual(new Set(["section-1"]));
      expect(mockState.hiddenOrgs).toEqual(new Set(["hidden-org"]));
      expect(mockState.hiddenRepos).toEqual(new Set(["hidden-repo"]));
      expect(mockState.hiddenPrs).toEqual(
        new Map([
          ["https://github.com/o/r/pull/1", "PR one"],
          ["https://github.com/o/r/pull/2", "PR two"],
        ]),
      );
      expect(mockState.followedPrs).toEqual(new Set(["https://github.com/o/r/pull/10"]));
      expect(mockState.setGroupByRepository).toHaveBeenCalledWith(false);
      expect(mockState.setFollowedUsers).toHaveBeenCalledWith(["alice", "bob"]);
    });

    it("clears existing state before populating", async () => {
      // Pre-populate state
      mockState.favoriteOrgs.add("stale-org");
      mockState.hiddenPrs.set("https://stale", "Stale PR");
      mockState.followedPrs.add("https://stale-followed");

      mockInvoke.mockResolvedValue(makeSettings({
        favorite_orgs: ["fresh-org"],
      }));

      await prefs.loadUserPrefs();

      expect(mockState.favoriteOrgs).toEqual(new Set(["fresh-org"]));
      expect(mockState.hiddenPrs.size).toBe(0);
      expect(mockState.followedPrs.size).toBe(0);
    });

    it("resets activeFollowFilter when selected user is removed from followed_users", async () => {
      mockState.activeFollowFilter = "alice";

      mockInvoke.mockResolvedValue(makeSettings({
        followed_users: ["bob", "charlie"],
      }));

      await prefs.loadUserPrefs();

      expect(mockState.setActiveFollowFilter).toHaveBeenCalledWith("all");
    });

    it("keeps activeFollowFilter when selected user still exists in followed_users", async () => {
      mockState.activeFollowFilter = "alice";

      mockInvoke.mockResolvedValue(makeSettings({
        followed_users: ["alice", "bob"],
      }));

      await prefs.loadUserPrefs();

      expect(mockState.setActiveFollowFilter).not.toHaveBeenCalled();
    });

    it("does not reset activeFollowFilter when it is 'all'", async () => {
      mockState.activeFollowFilter = "all";

      mockInvoke.mockResolvedValue(makeSettings({
        followed_users: [],
      }));

      await prefs.loadUserPrefs();

      expect(mockState.setActiveFollowFilter).not.toHaveBeenCalled();
    });

    it("handles missing optional fields (hidden_prs, followed_prs, followed_users)", async () => {
      const settings = makeSettings();
      // Simulate backend returning null/undefined for optional arrays
      const partial = { ...settings } as Record<string, unknown>;
      delete partial.hidden_prs;
      delete partial.followed_prs;
      delete partial.followed_users;

      mockInvoke.mockResolvedValue(partial);

      await prefs.loadUserPrefs();

      expect(mockState.hiddenPrs.size).toBe(0);
      expect(mockState.followedPrs.size).toBe(0);
      expect(mockState.setFollowedUsers).toHaveBeenCalledWith([]);
    });

    it("sets group_by_repository to true when field is not explicitly false", async () => {
      const settings = makeSettings();
      const partial = { ...settings } as Record<string, unknown>;
      delete partial.group_by_repository;

      mockInvoke.mockResolvedValue(partial);

      await prefs.loadUserPrefs();

      // group_by_repository !== false => true
      expect(mockState.setGroupByRepository).toHaveBeenCalledWith(true);
    });
  });

  // ── persistPrefs ──────────────────────────────────────────────────────────

  describe("persistPrefs", () => {
    it("serializes state back to settings and calls update_settings", async () => {
      const currentSettings = makeSettings();
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_settings") return Promise.resolve(currentSettings);
        if (cmd === "update_settings") return Promise.resolve();
        return Promise.resolve();
      });

      mockState.favoriteOrgs.add("my-org");
      mockState.favoriteRepos.add("my-repo");
      mockState.collapsedAccordions.add("accordion-1");
      mockState.hiddenOrgs.add("bad-org");
      mockState.hiddenRepos.add("bad-repo");
      mockState.hiddenPrs.set("https://github.com/o/r/pull/5", "Hidden PR");
      mockState.followedPrs.add("https://github.com/o/r/pull/99");

      prefs.persistPrefs();

      // Flush the queued microtask
      await vi.advanceTimersByTimeAsync(0);

      expect(mockInvoke).toHaveBeenCalledWith("get_settings");
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", {
        settings: expect.objectContaining({
          favorite_orgs: ["my-org"],
          favorite_repos: ["my-repo"],
          collapsed_accordions: ["accordion-1"],
          hidden_orgs: ["bad-org"],
          hidden_repos: ["bad-repo"],
          hidden_prs: [{ url: "https://github.com/o/r/pull/5", title: "Hidden PR" }],
          followed_prs: ["https://github.com/o/r/pull/99"],
        }),
      });
    });

    it("coalesces multiple calls into a single save (debounce)", async () => {
      const currentSettings = makeSettings();
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_settings") return Promise.resolve(currentSettings);
        if (cmd === "update_settings") return Promise.resolve();
        return Promise.resolve();
      });

      // Call persistPrefs three times rapidly
      prefs.persistPrefs();
      prefs.persistPrefs();
      prefs.persistPrefs();

      await vi.advanceTimersByTimeAsync(0);

      // get_settings + update_settings = 2 invoke calls total (not 6)
      const getSettingsCalls = mockInvoke.mock.calls.filter(
        ([cmd]: [string]) => cmd === "get_settings",
      );
      const updateSettingsCalls = mockInvoke.mock.calls.filter(
        ([cmd]: [string]) => cmd === "update_settings",
      );

      expect(getSettingsCalls).toHaveLength(1);
      expect(updateSettingsCalls).toHaveLength(1);
    });

    it("allows a new save after the first completes", async () => {
      const currentSettings = makeSettings();
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_settings") return Promise.resolve(currentSettings);
        if (cmd === "update_settings") return Promise.resolve();
        return Promise.resolve();
      });

      // First save
      prefs.persistPrefs();
      await vi.advanceTimersByTimeAsync(0);

      // Second save (should go through since first completed)
      prefs.persistPrefs();
      await vi.advanceTimersByTimeAsync(0);

      const updateCalls = mockInvoke.mock.calls.filter(
        ([cmd]: [string]) => cmd === "update_settings",
      );
      expect(updateCalls).toHaveLength(2);
    });
  });

  // ── toggleFavorite ────────────────────────────────────────────────────────

  describe("toggleFavorite", () => {
    beforeEach(() => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_settings") return Promise.resolve(makeSettings());
        if (cmd === "update_settings") return Promise.resolve();
        return Promise.resolve();
      });
    });

    it("adds an org to favoriteOrgs when not present", () => {
      const onRender = vi.fn();
      prefs.initPrefs(onRender, vi.fn());

      prefs.toggleFavorite("org", "new-org");

      expect(mockState.favoriteOrgs.has("new-org")).toBe(true);
      expect(onRender).toHaveBeenCalledOnce();
    });

    it("removes an org from favoriteOrgs when already present", () => {
      const onRender = vi.fn();
      prefs.initPrefs(onRender, vi.fn());
      mockState.favoriteOrgs.add("existing-org");

      prefs.toggleFavorite("org", "existing-org");

      expect(mockState.favoriteOrgs.has("existing-org")).toBe(false);
      expect(onRender).toHaveBeenCalledOnce();
    });

    it("adds a repo to favoriteRepos when not present", () => {
      const onRender = vi.fn();
      prefs.initPrefs(onRender, vi.fn());

      prefs.toggleFavorite("repo", "my-repo");

      expect(mockState.favoriteRepos.has("my-repo")).toBe(true);
    });

    it("removes a repo from favoriteRepos when already present", () => {
      const onRender = vi.fn();
      prefs.initPrefs(onRender, vi.fn());
      mockState.favoriteRepos.add("old-repo");

      prefs.toggleFavorite("repo", "old-repo");

      expect(mockState.favoriteRepos.has("old-repo")).toBe(false);
    });

    it("calls persistPrefs to save the change", async () => {
      prefs.initPrefs(vi.fn(), vi.fn());

      prefs.toggleFavorite("org", "save-me");
      await vi.advanceTimersByTimeAsync(0);

      expect(mockInvoke).toHaveBeenCalledWith("get_settings");
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", expect.any(Object));
    });
  });

  // ── toggleHidden ──────────────────────────────────────────────────────────

  describe("toggleHidden", () => {
    beforeEach(() => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_settings") return Promise.resolve(makeSettings());
        if (cmd === "update_settings") return Promise.resolve();
        return Promise.resolve();
      });
    });

    it("adds an org to hiddenOrgs when not present", async () => {
      const onRender = vi.fn();
      const onReload = vi.fn();
      prefs.initPrefs(onRender, onReload);

      await prefs.toggleHidden("org", "hide-org");

      expect(mockState.hiddenOrgs.has("hide-org")).toBe(true);
      expect(onRender).toHaveBeenCalledOnce();
      expect(onReload).toHaveBeenCalledOnce();
    });

    it("removes an org from hiddenOrgs when already present", async () => {
      const onRender = vi.fn();
      const onReload = vi.fn();
      prefs.initPrefs(onRender, onReload);
      mockState.hiddenOrgs.add("visible-org");

      await prefs.toggleHidden("org", "visible-org");

      expect(mockState.hiddenOrgs.has("visible-org")).toBe(false);
      expect(onRender).toHaveBeenCalledOnce();
      expect(onReload).toHaveBeenCalledOnce();
    });

    it("adds a repo to hiddenRepos when not present", async () => {
      const onRender = vi.fn();
      const onReload = vi.fn();
      prefs.initPrefs(onRender, onReload);

      await prefs.toggleHidden("repo", "hide-repo");

      expect(mockState.hiddenRepos.has("hide-repo")).toBe(true);
    });

    it("removes a repo from hiddenRepos when already present", async () => {
      prefs.initPrefs(vi.fn(), vi.fn());
      mockState.hiddenRepos.add("show-repo");

      await prefs.toggleHidden("repo", "show-repo");

      expect(mockState.hiddenRepos.has("show-repo")).toBe(false);
    });

    it("calls onRender before saving and onReload after saving", async () => {
      const callOrder: string[] = [];
      const onRender = vi.fn(() => callOrder.push("render"));
      const onReload = vi.fn(() => callOrder.push("reload"));
      prefs.initPrefs(onRender, onReload);

      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "get_settings") {
          callOrder.push("get_settings");
          return Promise.resolve(makeSettings());
        }
        if (cmd === "update_settings") {
          callOrder.push("update_settings");
          return Promise.resolve();
        }
        return Promise.resolve();
      });

      await prefs.toggleHidden("org", "test-org");

      expect(callOrder).toEqual([
        "render",
        "get_settings",
        "update_settings",
        "reload",
      ]);
    });

    it("saves current state of all preference sets to settings", async () => {
      prefs.initPrefs(vi.fn(), vi.fn());

      mockState.favoriteOrgs.add("fav-org");
      mockState.favoriteRepos.add("fav-repo");
      mockState.collapsedAccordions.add("collapsed-1");

      await prefs.toggleHidden("org", "new-hidden");

      expect(mockInvoke).toHaveBeenCalledWith("update_settings", {
        settings: expect.objectContaining({
          favorite_orgs: ["fav-org"],
          favorite_repos: ["fav-repo"],
          collapsed_accordions: ["collapsed-1"],
          hidden_orgs: ["new-hidden"],
          hidden_repos: [],
        }),
      });
    });
  });
});
