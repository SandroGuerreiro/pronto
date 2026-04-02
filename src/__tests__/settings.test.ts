import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Settings, NotificationPreferences } from "../types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockState } = vi.hoisted(() => {
  const mockState = {
    favoriteOrgs: new Set<string>(),
    favoriteRepos: new Set<string>(),
    collapsedAccordions: new Set<string>(),
    hiddenOrgs: new Set<string>(),
    hiddenRepos: new Set<string>(),
    hiddenPrs: new Map<string, string>(),
    followedUsers: [] as string[],
    followedPrs: new Set<string>(),
    activeFollowFilter: "all",
    keybindings: {
      navigate_down: "j",
      navigate_up: "k",
      expand: "l",
      collapse: "h",
      open_pr: "Enter",
      hide_pr: "i",
      copy_url: "c",
      tab_owned: "1",
      tab_followed: "2",
      tab_merged: "3",
      tab_closed: "4",
      global_toggle: "Super+Ctrl+P",
      global_reload: "Super+Ctrl+R",
    } as Record<string, string>,
    setGroupByRepository: vi.fn(),
    setFollowedUsers: vi.fn((u: string[]) => {
      mockState.followedUsers = u;
    }),
    setActiveFollowFilter: vi.fn((f: string) => {
      mockState.activeFollowFilter = f;
    }),
    setKeybindings: vi.fn(),
    setShowRecentlyMerged: vi.fn(),
    setShowClosed: vi.fn(),
    setSettingsNavIndex: vi.fn(),
    setSettingsGroupIndex: vi.fn(),
  };
  return { mockState };
});

vi.mock("../state", () => ({
  get favoriteOrgs() { return mockState.favoriteOrgs; },
  get favoriteRepos() { return mockState.favoriteRepos; },
  get collapsedAccordions() { return mockState.collapsedAccordions; },
  get hiddenOrgs() { return mockState.hiddenOrgs; },
  get hiddenRepos() { return mockState.hiddenRepos; },
  get hiddenPrs() { return mockState.hiddenPrs; },
  get followedUsers() { return mockState.followedUsers; },
  get followedPrs() { return mockState.followedPrs; },
  get activeFollowFilter() { return mockState.activeFollowFilter; },
  get keybindings() { return mockState.keybindings; },
  setGroupByRepository: (...args: unknown[]) => mockState.setGroupByRepository(...args),
  setFollowedUsers: (...args: unknown[]) => mockState.setFollowedUsers(...args),
  setActiveFollowFilter: (...args: unknown[]) => mockState.setActiveFollowFilter(...args),
  setKeybindings: (...args: unknown[]) => mockState.setKeybindings(...args),
  setShowRecentlyMerged: (...args: unknown[]) => mockState.setShowRecentlyMerged(...args),
  setShowClosed: (...args: unknown[]) => mockState.setShowClosed(...args),
  setSettingsNavIndex: (...args: unknown[]) => mockState.setSettingsNavIndex(...args),
  setSettingsGroupIndex: (...args: unknown[]) => mockState.setSettingsGroupIndex(...args),
}));

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import {
  loadNotifPrefsFromSettings,
  initSettings,
  hideSettings,
  autoSaveSettings,
  showSettings,
} from "../settings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDefaultNotifPrefs(): NotificationPreferences {
  return {
    review_required: false,
    changes_requested: false,
    approved: false,
    checks_failed: false,
    checks_recovered: false,
    kicked_from_queue: false,
    new_comment: false,
    new_comment_participated: false,
  };
}

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
      review_required: false,
      changes_requested: true,
      approved: true,
      checks_failed: true,
      checks_recovered: false,
      kicked_from_queue: true,
      new_comment: true,
      new_comment_participated: false,
    },
    notification_prefs_followed: {
      review_required: true,
      changes_requested: false,
      approved: false,
      checks_failed: false,
      checks_recovered: false,
      kicked_from_queue: false,
      new_comment: false,
      new_comment_participated: false,
    },
    notify_on_merged: true,
    notify_on_closed: false,
    homebrew_check_enabled: false,
    homebrew_check_interval_secs: 14400,
    popup_screen: "primary",
    notification_sound: true,
    ...overrides,
  };
}

function setupDom(): void {
  document.body.innerHTML = `<div id="content"></div>`;
}

function resetMockState(): void {
  mockState.favoriteOrgs = new Set<string>();
  mockState.favoriteRepos = new Set<string>();
  mockState.collapsedAccordions = new Set<string>();
  mockState.hiddenOrgs = new Set<string>();
  mockState.hiddenRepos = new Set<string>();
  mockState.hiddenPrs = new Map<string, string>();
  mockState.followedUsers = [];
  mockState.followedPrs = new Set<string>();
  mockState.activeFollowFilter = "all";
  mockState.keybindings = {
    navigate_down: "j",
    navigate_up: "k",
    expand: "l",
    collapse: "h",
    open_pr: "Enter",
    hide_pr: "i",
    copy_url: "c",
    tab_owned: "1",
    tab_followed: "2",
    tab_merged: "3",
    tab_closed: "4",
    global_toggle: "Super+Ctrl+P",
    global_reload: "Super+Ctrl+R",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  resetMockState();
  setupDom();
  mockInvoke.mockResolvedValue(makeSettings());
});

// ── loadNotifPrefsFromSettings ──────────────────────────────────────────────

describe("loadNotifPrefsFromSettings", () => {
  it("loads all notification preferences from settings", () => {
    const settings = makeSettings({
      notifications_enabled: false,
      notification_prefs_owned: {
        ...makeDefaultNotifPrefs(),
        changes_requested: true,
        approved: true,
      },
      notification_prefs_followed: {
        ...makeDefaultNotifPrefs(),
        review_required: true,
      },
      notify_on_merged: false,
      notify_on_closed: true,
      homebrew_check_enabled: true,
      homebrew_check_interval_secs: 3600,
      popup_screen: "active",
    });

    loadNotifPrefsFromSettings(settings);

    // Verify state was loaded by calling autoSaveSettings and checking what was saved
    // The module-level state is reflected in the update_settings call
  });

  it("uses defaults when fields are missing/undefined", () => {
    // Create settings with undefined-ish fields via partial
    const settings = {
      ...makeSettings(),
      notifications_enabled: undefined,
      notify_on_merged: undefined,
      notify_on_closed: undefined,
      homebrew_check_enabled: undefined,
      homebrew_check_interval_secs: undefined,
      popup_screen: undefined,
    } as unknown as Settings;

    loadNotifPrefsFromSettings(settings);

    // Verify defaults are used: call autoSaveSettings and check the saved values
    // The nullish coalescing should produce defaults
  });

  it("merges partial notification prefs with defaults", async () => {
    const partialOwned = { changes_requested: true } as NotificationPreferences;
    const settings = makeSettings({
      notification_prefs_owned: partialOwned,
      notification_prefs_followed: { approved: true } as NotificationPreferences,
      notifications_enabled: false,
      notify_on_merged: false,
      notify_on_closed: true,
      homebrew_check_enabled: true,
      homebrew_check_interval_secs: 86400,
      popup_screen: "active",
    });

    loadNotifPrefsFromSettings(settings);

    // Now verify the merged state shows up in autoSaveSettings output
    await autoSaveSettings();

    const savedSettings = mockInvoke.mock.calls.find(
      (c) => c[0] === "update_settings"
    )?.[1]?.settings as Settings;

    expect(savedSettings).toBeDefined();

    // Partial owned merged with defaults: changes_requested=true, rest false
    expect(savedSettings.notification_prefs_owned.changes_requested).toBe(true);
    expect(savedSettings.notification_prefs_owned.review_required).toBe(false);
    expect(savedSettings.notification_prefs_owned.approved).toBe(false);
    expect(savedSettings.notification_prefs_owned.checks_failed).toBe(false);

    // Partial followed merged with defaults: approved=true, rest false
    expect(savedSettings.notification_prefs_followed.approved).toBe(true);
    expect(savedSettings.notification_prefs_followed.review_required).toBe(false);

    // Other module-level state
    expect(savedSettings.notifications_enabled).toBe(false);
    expect(savedSettings.notify_on_merged).toBe(false);
    expect(savedSettings.notify_on_closed).toBe(true);
    expect(savedSettings.homebrew_check_enabled).toBe(true);
    expect(savedSettings.homebrew_check_interval_secs).toBe(86400);
    expect(savedSettings.popup_screen).toBe("active");
  });

  it("uses default values for all undefined fields via nullish coalescing", async () => {
    const settings = {
      ...makeSettings(),
      notifications_enabled: undefined,
      notify_on_merged: undefined,
      notify_on_closed: undefined,
      homebrew_check_enabled: undefined,
      homebrew_check_interval_secs: undefined,
      popup_screen: undefined,
    } as unknown as Settings;

    loadNotifPrefsFromSettings(settings);
    await autoSaveSettings();

    const savedSettings = mockInvoke.mock.calls.find(
      (c) => c[0] === "update_settings"
    )?.[1]?.settings as Settings;

    // Defaults from nullish coalescing
    expect(savedSettings.notifications_enabled).toBe(true);
    expect(savedSettings.notify_on_merged).toBe(true);
    expect(savedSettings.notify_on_closed).toBe(false);
    expect(savedSettings.homebrew_check_enabled).toBe(false);
    expect(savedSettings.homebrew_check_interval_secs).toBe(14400);
    expect(savedSettings.popup_screen).toBe("primary");
  });
});

// ── initSettings / hideSettings ─────────────────────────────────────────────

describe("initSettings / hideSettings", () => {
  it("initSettings stores callback and hideSettings calls it", () => {
    const callback = vi.fn();
    initSettings(callback);
    expect(callback).not.toHaveBeenCalled();

    hideSettings();
    expect(callback).toHaveBeenCalledOnce();
  });

  it("hideSettings calls the most recently stored callback", () => {
    const first = vi.fn();
    const second = vi.fn();

    initSettings(first);
    initSettings(second);
    hideSettings();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});

// ── autoSaveSettings ────────────────────────────────────────────────────────

describe("autoSaveSettings", () => {
  it("reads existing settings via invoke('get_settings') as fallback", async () => {
    // No DOM elements present, so all values should come from currentSettings
    await autoSaveSettings();

    expect(mockInvoke).toHaveBeenCalledWith("get_settings");
    expect(mockInvoke).toHaveBeenCalledWith("update_settings", expect.objectContaining({
      settings: expect.objectContaining({
        poll_interval_secs: 120,
      }),
    }));
  });

  it("reads DOM elements when present", async () => {
    // Add some DOM elements that autoSaveSettings reads
    document.body.innerHTML = `
      <div id="content"></div>
      <select id="setting-poll"><option value="300" selected>5 min</option></select>
      <input type="checkbox" id="setting-merged" checked />
      <select id="setting-merged-hours"><option value="48" selected>48h</option></select>
      <input type="checkbox" id="setting-group-repo" />
    `;

    await autoSaveSettings();

    const savedSettings = mockInvoke.mock.calls.find(
      (c) => c[0] === "update_settings"
    )?.[1]?.settings as Settings;

    expect(savedSettings.poll_interval_secs).toBe(300);
    expect(savedSettings.show_recently_merged).toBe(true);
    expect(savedSettings.merged_window_hours).toBe(48);
    expect(savedSettings.group_by_repository).toBe(false); // unchecked
  });

  it("uses currentSettings values when DOM elements are absent", async () => {
    const customSettings = makeSettings({
      poll_interval_secs: 600,
      show_recently_merged: false,
      merged_window_hours: 12,
      workflow_monitor_enabled: true,
      workflow_org: "my-org",
      workflow_repo: "my-repo",
      workflow_name: "deploy.yml",
    });
    mockInvoke.mockResolvedValue(customSettings);

    await autoSaveSettings();

    const savedSettings = mockInvoke.mock.calls.find(
      (c) => c[0] === "update_settings"
    )?.[1]?.settings as Settings;

    expect(savedSettings.poll_interval_secs).toBe(600);
    expect(savedSettings.show_recently_merged).toBe(false);
    expect(savedSettings.merged_window_hours).toBe(12);
    expect(savedSettings.workflow_monitor_enabled).toBe(true);
    expect(savedSettings.workflow_org).toBe("my-org");
    expect(savedSettings.workflow_repo).toBe("my-repo");
    expect(savedSettings.workflow_name).toBe("deploy.yml");
  });

  it("includes module-level notification state in saved settings", async () => {
    loadNotifPrefsFromSettings(makeSettings({
      notifications_enabled: false,
      notification_prefs_owned: {
        ...makeDefaultNotifPrefs(),
        approved: true,
        checks_failed: true,
      },
      notify_on_merged: false,
      notify_on_closed: true,
    }));

    await autoSaveSettings();

    const savedSettings = mockInvoke.mock.calls.find(
      (c) => c[0] === "update_settings"
    )?.[1]?.settings as Settings;

    expect(savedSettings.notifications_enabled).toBe(false);
    expect(savedSettings.notification_prefs_owned.approved).toBe(true);
    expect(savedSettings.notification_prefs_owned.checks_failed).toBe(true);
    expect(savedSettings.notify_on_merged).toBe(false);
    expect(savedSettings.notify_on_closed).toBe(true);
  });

  it("calls invoke('update_settings') with merged settings", async () => {
    await autoSaveSettings();

    expect(mockInvoke).toHaveBeenCalledWith("update_settings", {
      settings: expect.objectContaining({
        poll_interval_secs: expect.any(Number),
        notifications_enabled: expect.any(Boolean),
        favorite_orgs: expect.any(Array),
        followed_users: expect.any(Array),
      }),
    });
  });

  it("calls setGroupByRepository with updated value", async () => {
    document.body.innerHTML = `
      <div id="content"></div>
      <input type="checkbox" id="setting-group-repo" checked />
    `;

    await autoSaveSettings();

    expect(mockState.setGroupByRepository).toHaveBeenCalledWith(true);
  });

  it("spreads state sets/maps into arrays for serialization", async () => {
    mockState.favoriteOrgs = new Set(["org1", "org2"]);
    mockState.favoriteRepos = new Set(["repo1"]);
    mockState.hiddenPrs = new Map([
      ["https://github.com/o/r/pull/1", "Fix bug"],
    ]);
    mockState.followedPrs = new Set(["https://github.com/o/r/pull/2"]);

    await autoSaveSettings();

    const savedSettings = mockInvoke.mock.calls.find(
      (c) => c[0] === "update_settings"
    )?.[1]?.settings as Settings;

    expect(savedSettings.favorite_orgs).toEqual(["org1", "org2"]);
    expect(savedSettings.favorite_repos).toEqual(["repo1"]);
    expect(savedSettings.hidden_prs).toEqual([
      { url: "https://github.com/o/r/pull/1", title: "Fix bug" },
    ]);
    expect(savedSettings.followed_prs).toEqual(["https://github.com/o/r/pull/2"]);
  });
});

// ── showSettings ────────────────────────────────────────────────────────────

describe("showSettings", () => {
  beforeEach(() => {
    // showSettings calls invoke("get_settings") to get fresh settings
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(makeSettings());
      if (cmd === "update_settings") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
  });

  it("renders settings-view container with sidebar tabs", async () => {
    await showSettings();

    const settingsView = document.querySelector(".settings-view");
    expect(settingsView).toBeTruthy();

    const sidebar = document.querySelector(".settings-sidebar");
    expect(sidebar).toBeTruthy();

    const tabs = document.querySelectorAll(".settings-tab");
    expect(tabs.length).toBe(6);

    const tabNames = [...tabs].map((t) => t.getAttribute("data-tab"));
    expect(tabNames).toEqual([
      "general",
      "notifications",
      "workflow",
      "shortcuts",
      "updates",
      "subscriptions",
    ]);
  });

  it("renders general tab by default with polling interval", async () => {
    await showSettings();

    const pollSelect = document.getElementById("setting-poll") as HTMLSelectElement;
    expect(pollSelect).toBeTruthy();
    expect(pollSelect.value).toBe("120"); // default 2 minutes
  });

  it("general tab: renders group by repo toggle", async () => {
    await showSettings();

    const groupRepoEl = document.getElementById("setting-group-repo") as HTMLInputElement;
    expect(groupRepoEl).toBeTruthy();
    expect(groupRepoEl.checked).toBe(true);
  });

  it("general tab: renders merged/closed toggles", async () => {
    await showSettings();

    const mergedEl = document.getElementById("setting-merged") as HTMLInputElement;
    const closedEl = document.getElementById("setting-closed") as HTMLInputElement;
    expect(mergedEl).toBeTruthy();
    expect(closedEl).toBeTruthy();
    expect(mergedEl.checked).toBe(true); // show_recently_merged default
    expect(closedEl.checked).toBe(false); // show_closed default
  });

  it("general tab: toggling 'show merged' shows/hides merged-window-group", async () => {
    await showSettings();

    const mergedEl = document.getElementById("setting-merged") as HTMLInputElement;
    const mergedWindowGroup = document.getElementById("merged-window-group") as HTMLElement;

    // Initially visible (show_recently_merged = true)
    expect(mergedWindowGroup.style.display).toBe("");

    // Uncheck
    mergedEl.checked = false;
    mergedEl.dispatchEvent(new Event("change"));

    expect(mergedWindowGroup.style.display).toBe("none");
    expect(mockState.setShowRecentlyMerged).toHaveBeenCalledWith(false);
  });

  it("general tab: toggling 'show closed' shows/hides closed-window-group", async () => {
    await showSettings();

    const closedEl = document.getElementById("setting-closed") as HTMLInputElement;
    const closedWindowGroup = document.getElementById("closed-window-group") as HTMLElement;

    // Initially hidden (show_closed = false)
    expect(closedWindowGroup.style.display).toBe("none");

    // Check
    closedEl.checked = true;
    closedEl.dispatchEvent(new Event("change"));

    expect(closedWindowGroup.style.display).toBe("");
    expect(mockState.setShowClosed).toHaveBeenCalledWith(true);
  });

  it("general tab: popup screen select updates hint text", async () => {
    await showSettings();

    const popupScreenEl = document.getElementById("setting-popup-screen") as HTMLSelectElement;
    const hint = popupScreenEl.closest(".settings-group")?.querySelector(".settings-hint") as HTMLElement;

    expect(hint.textContent).toBe("Always opens on your main display");

    // Change to active
    popupScreenEl.value = "active";
    popupScreenEl.dispatchEvent(new Event("change"));

    // Wait for async autoSaveSettings
    await vi.waitFor(() => {
      expect(hint.textContent).toBe("Opens where your cursor is");
    });
  });

  // ── Notifications tab ───────────────────────────────────────────────────

  it("notifications tab: renders master toggle and per-category checkboxes", async () => {
    loadNotifPrefsFromSettings(makeSettings({
      notifications_enabled: true,
      notification_prefs_owned: {
        ...makeDefaultNotifPrefs(),
        changes_requested: true,
      },
    }));

    await showSettings();

    // Switch to notifications tab
    const notifTab = document.querySelector('[data-tab="notifications"]') as HTMLElement;
    notifTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("notif-master")).toBeTruthy();
    });

    const masterEl = document.getElementById("notif-master") as HTMLInputElement;
    expect(masterEl.checked).toBe(true);

    const ownedChanges = document.getElementById("notif-owned-changes_requested") as HTMLInputElement;
    expect(ownedChanges.checked).toBe(true);

    const ownedApproved = document.getElementById("notif-owned-approved") as HTMLInputElement;
    expect(ownedApproved.checked).toBe(false);
  });

  it("notifications tab: toggling a checkbox triggers autoSaveSettings", async () => {
    loadNotifPrefsFromSettings(makeSettings());
    await showSettings();

    const notifTab = document.querySelector('[data-tab="notifications"]') as HTMLElement;
    notifTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("notif-master")).toBeTruthy();
    });

    mockInvoke.mockClear();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(makeSettings());
      return Promise.resolve(undefined);
    });

    const checkbox = document.getElementById("notif-owned-approved") as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", expect.anything());
    });
  });

  it("notifications tab: toggling master notification toggle auto-saves", async () => {
    loadNotifPrefsFromSettings(makeSettings({ notifications_enabled: true }));
    await showSettings();

    const notifTab = document.querySelector('[data-tab="notifications"]') as HTMLElement;
    notifTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("notif-master")).toBeTruthy();
    });

    mockInvoke.mockClear();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(makeSettings());
      return Promise.resolve(undefined);
    });

    const masterEl = document.getElementById("notif-master") as HTMLInputElement;
    masterEl.checked = false;
    masterEl.dispatchEvent(new Event("change"));

    await vi.waitFor(() => {
      const updateCall = mockInvoke.mock.calls.find((c) => c[0] === "update_settings");
      expect(updateCall).toBeTruthy();
      expect((updateCall![1] as { settings: Settings }).settings.notifications_enabled).toBe(false);
    });
  });

  // ── Workflow tab ────────────────────────────────────────────────────────

  it("workflow tab: renders workflow config with toggle", async () => {
    await showSettings();

    const wfTab = document.querySelector('[data-tab="workflow"]') as HTMLElement;
    wfTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("setting-workflow-enabled")).toBeTruthy();
    });

    const wfEnabled = document.getElementById("setting-workflow-enabled") as HTMLInputElement;
    const configGroup = document.getElementById("workflow-config-group") as HTMLElement;

    expect(wfEnabled.checked).toBe(false); // default
    expect(configGroup.style.display).toBe("none");
  });

  it("workflow tab: toggling monitor shows/hides config group", async () => {
    await showSettings();

    const wfTab = document.querySelector('[data-tab="workflow"]') as HTMLElement;
    wfTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("setting-workflow-enabled")).toBeTruthy();
    });

    const wfEnabled = document.getElementById("setting-workflow-enabled") as HTMLInputElement;
    const configGroup = document.getElementById("workflow-config-group") as HTMLElement;

    wfEnabled.checked = true;
    wfEnabled.dispatchEvent(new Event("change"));

    expect(configGroup.style.display).toBe("");
  });

  // ── Shortcuts tab ───────────────────────────────────────────────────────

  it("shortcuts tab: renders keybinding buttons with formatted keys", async () => {
    await showSettings();

    const kbTab = document.querySelector('[data-tab="shortcuts"]') as HTMLElement;
    kbTab.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-action="navigate_down"]')).toBeTruthy();
    });

    const downBtn = document.querySelector('[data-action="navigate_down"]') as HTMLElement;
    expect(downBtn.textContent).toBe("J"); // formatKeybinding("j") -> "J"

    const openPrBtn = document.querySelector('[data-action="open_pr"]') as HTMLElement;
    expect(openPrBtn.textContent).toBe("\u23CE"); // formatKeybinding("Enter") -> "⏎"

    const globalToggleBtn = document.querySelector('[data-action="global_toggle"]') as HTMLElement;
    expect(globalToggleBtn.textContent).toBe("Super+Ctrl+P"); // global shortcut, raw value
  });

  // ── Updates tab ─────────────────────────────────────────────────────────

  it("updates tab: renders homebrew toggle and interval", async () => {
    loadNotifPrefsFromSettings(makeSettings({
      homebrew_check_enabled: true,
      homebrew_check_interval_secs: 3600,
    }));

    await showSettings();

    const updatesTab = document.querySelector('[data-tab="updates"]') as HTMLElement;
    updatesTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("setting-brew-enabled")).toBeTruthy();
    });

    const brewEnabled = document.getElementById("setting-brew-enabled") as HTMLInputElement;
    expect(brewEnabled.checked).toBe(true);

    const intervalGroup = document.getElementById("brew-interval-group") as HTMLElement;
    expect(intervalGroup.style.display).toBe("");

    const intervalSelect = document.getElementById("setting-brew-interval") as HTMLSelectElement;
    expect(intervalSelect.value).toBe("3600");
  });

  it("updates tab: toggling brew check shows/hides interval and auto-saves", async () => {
    loadNotifPrefsFromSettings(makeSettings({ homebrew_check_enabled: false }));
    await showSettings();

    const updatesTab = document.querySelector('[data-tab="updates"]') as HTMLElement;
    updatesTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("setting-brew-enabled")).toBeTruthy();
    });

    const brewEnabled = document.getElementById("setting-brew-enabled") as HTMLInputElement;
    const intervalGroup = document.getElementById("brew-interval-group") as HTMLElement;

    expect(intervalGroup.style.display).toBe("none");

    mockInvoke.mockClear();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(makeSettings());
      return Promise.resolve(undefined);
    });

    brewEnabled.checked = true;
    brewEnabled.dispatchEvent(new Event("change"));

    expect(intervalGroup.style.display).toBe("");
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", expect.anything());
    });
  });

  // ── Subscriptions tab ─────────────────────────────────────────────────

  it("subscriptions tab: renders followed users list", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings")
        return Promise.resolve(makeSettings({ followed_users: ["alice", "bob"] }));
      return Promise.resolve(undefined);
    });

    await showSettings();

    const subTab = document.querySelector('[data-tab="subscriptions"]') as HTMLElement;
    subTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("follow-users-list")).toBeTruthy();
    });

    const userRows = document.querySelectorAll('#follow-users-list .hidden-pr-row');
    expect(userRows.length).toBe(2);
    expect(userRows[0].querySelector(".hidden-pr-title")?.textContent).toBe("alice");
    expect(userRows[1].querySelector(".hidden-pr-title")?.textContent).toBe("bob");
  });

  it("subscriptions tab: renders followed PRs list with short display", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings")
        return Promise.resolve(
          makeSettings({ followed_prs: ["https://github.com/org/repo/pull/42"] })
        );
      return Promise.resolve(undefined);
    });

    await showSettings();

    const subTab = document.querySelector('[data-tab="subscriptions"]') as HTMLElement;
    subTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("follow-prs-list")).toBeTruthy();
    });

    const prRows = document.querySelectorAll('#follow-prs-list .hidden-pr-row');
    expect(prRows.length).toBe(1);
    expect(prRows[0].querySelector(".hidden-pr-title")?.textContent).toBe("org/repo #42");
  });

  it("subscriptions tab: adding a user updates state and auto-saves", async () => {
    mockState.followedUsers = ["existing-user"];

    await showSettings();

    const subTab = document.querySelector('[data-tab="subscriptions"]') as HTMLElement;
    subTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("follow-user-input")).toBeTruthy();
    });

    mockInvoke.mockClear();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(makeSettings());
      return Promise.resolve(undefined);
    });

    const input = document.getElementById("follow-user-input") as HTMLInputElement;
    const addBtn = document.getElementById("follow-user-add") as HTMLButtonElement;

    input.value = "newuser";
    addBtn.click();

    expect(input.value).toBe("");
    expect(mockState.followedUsers).toContain("newuser");

    // Check that a row was added
    const userRows = document.querySelectorAll('#follow-users-list .hidden-pr-row');
    const lastRow = userRows[userRows.length - 1];
    expect(lastRow.querySelector(".hidden-pr-title")?.textContent).toBe("newuser");

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", expect.anything());
    });
  });

  it("subscriptions tab: adding a user with @ prefix strips it", async () => {
    await showSettings();

    const subTab = document.querySelector('[data-tab="subscriptions"]') as HTMLElement;
    subTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("follow-user-input")).toBeTruthy();
    });

    const input = document.getElementById("follow-user-input") as HTMLInputElement;
    const addBtn = document.getElementById("follow-user-add") as HTMLButtonElement;

    input.value = "@octocat";
    addBtn.click();

    expect(mockState.followedUsers).toContain("octocat");
  });

  it("subscriptions tab: adding a duplicate user is a no-op", async () => {
    mockState.followedUsers = ["alice"];
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings")
        return Promise.resolve(makeSettings({ followed_users: ["alice"] }));
      return Promise.resolve(undefined);
    });

    await showSettings();

    const subTab = document.querySelector('[data-tab="subscriptions"]') as HTMLElement;
    subTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("follow-user-input")).toBeTruthy();
    });

    const initialRowCount = document.querySelectorAll('#follow-users-list .hidden-pr-row').length;

    const input = document.getElementById("follow-user-input") as HTMLInputElement;
    const addBtn = document.getElementById("follow-user-add") as HTMLButtonElement;

    input.value = "alice";
    addBtn.click();

    const afterRowCount = document.querySelectorAll('#follow-users-list .hidden-pr-row').length;
    expect(afterRowCount).toBe(initialRowCount);
  });

  it("subscriptions tab: removing a user updates state and auto-saves", async () => {
    mockState.followedUsers = ["alice", "bob"];
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings")
        return Promise.resolve(makeSettings({ followed_users: ["alice", "bob"] }));
      return Promise.resolve(undefined);
    });

    await showSettings();

    const subTab = document.querySelector('[data-tab="subscriptions"]') as HTMLElement;
    subTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("follow-users-list")).toBeTruthy();
    });

    mockInvoke.mockClear();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(makeSettings());
      return Promise.resolve(undefined);
    });

    const removeBtn = document.querySelector('.follow-user-remove[data-user="alice"]') as HTMLElement;
    removeBtn.click();

    expect(mockState.setFollowedUsers).toHaveBeenCalled();
    // The filter removes "alice"
    const lastCall = mockState.setFollowedUsers.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(["bob"]);

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", expect.anything());
    });
  });

  it("subscriptions tab: removing the active follow filter resets to 'all'", async () => {
    mockState.followedUsers = ["alice"];
    mockState.activeFollowFilter = "alice";
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings")
        return Promise.resolve(makeSettings({ followed_users: ["alice"] }));
      return Promise.resolve(undefined);
    });

    await showSettings();

    const subTab = document.querySelector('[data-tab="subscriptions"]') as HTMLElement;
    subTab.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.follow-user-remove[data-user="alice"]')).toBeTruthy();
    });

    const removeBtn = document.querySelector('.follow-user-remove[data-user="alice"]') as HTMLElement;
    removeBtn.click();

    expect(mockState.setActiveFollowFilter).toHaveBeenCalledWith("all");
  });

  it("subscriptions tab: adding a PR URL normalizes and adds to followedPrs", async () => {
    await showSettings();

    const subTab = document.querySelector('[data-tab="subscriptions"]') as HTMLElement;
    subTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("follow-pr-input")).toBeTruthy();
    });

    mockInvoke.mockClear();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(makeSettings());
      return Promise.resolve(undefined);
    });

    const input = document.getElementById("follow-pr-input") as HTMLInputElement;
    const addBtn = document.getElementById("follow-pr-add") as HTMLButtonElement;

    input.value = "https://github.com/org/repo/pull/99";
    addBtn.click();

    expect(input.value).toBe("");
    expect(mockState.followedPrs.has("https://github.com/org/repo/pull/99")).toBe(true);

    // Row added with short display
    const prRows = document.querySelectorAll('#follow-prs-list .hidden-pr-row');
    expect(prRows.length).toBe(1);
    expect(prRows[0].querySelector(".hidden-pr-title")?.textContent).toBe("org/repo #99");

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", expect.anything());
    });
  });

  it("subscriptions tab: adding a short-form PR URL normalizes to full URL", async () => {
    await showSettings();

    const subTab = document.querySelector('[data-tab="subscriptions"]') as HTMLElement;
    subTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("follow-pr-input")).toBeTruthy();
    });

    const input = document.getElementById("follow-pr-input") as HTMLInputElement;
    const addBtn = document.getElementById("follow-pr-add") as HTMLButtonElement;

    input.value = "org/repo/pull/42";
    addBtn.click();

    expect(mockState.followedPrs.has("https://github.com/org/repo/pull/42")).toBe(true);
  });

  it("subscriptions tab: adding a duplicate PR URL is a no-op", async () => {
    mockState.followedPrs = new Set(["https://github.com/org/repo/pull/1"]);
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings")
        return Promise.resolve(
          makeSettings({ followed_prs: ["https://github.com/org/repo/pull/1"] })
        );
      return Promise.resolve(undefined);
    });

    await showSettings();

    const subTab = document.querySelector('[data-tab="subscriptions"]') as HTMLElement;
    subTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("follow-pr-input")).toBeTruthy();
    });

    const initialCount = document.querySelectorAll('#follow-prs-list .hidden-pr-row').length;

    const input = document.getElementById("follow-pr-input") as HTMLInputElement;
    const addBtn = document.getElementById("follow-pr-add") as HTMLButtonElement;

    input.value = "https://github.com/org/repo/pull/1";
    addBtn.click();

    const afterCount = document.querySelectorAll('#follow-prs-list .hidden-pr-row').length;
    expect(afterCount).toBe(initialCount);
  });

  it("subscriptions tab: removing a PR URL removes from followedPrs", async () => {
    mockState.followedPrs = new Set(["https://github.com/org/repo/pull/1"]);
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings")
        return Promise.resolve(
          makeSettings({ followed_prs: ["https://github.com/org/repo/pull/1"] })
        );
      return Promise.resolve(undefined);
    });

    await showSettings();

    const subTab = document.querySelector('[data-tab="subscriptions"]') as HTMLElement;
    subTab.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.follow-pr-remove')).toBeTruthy();
    });

    mockInvoke.mockClear();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(makeSettings());
      return Promise.resolve(undefined);
    });

    const removeBtn = document.querySelector('.follow-pr-remove') as HTMLElement;
    removeBtn.click();

    expect(mockState.followedPrs.has("https://github.com/org/repo/pull/1")).toBe(false);

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", expect.anything());
    });
  });

  it("subscriptions tab: unhiding a PR removes from hiddenPrs", async () => {
    mockState.hiddenPrs = new Map([
      ["https://github.com/org/repo/pull/5", "Hidden PR title"],
    ]);

    await showSettings();

    const subTab = document.querySelector('[data-tab="subscriptions"]') as HTMLElement;
    subTab.click();
    await vi.waitFor(() => {
      expect(
        document.querySelector('.hidden-pr-remove:not(.follow-pr-remove)[data-pr-url]')
      ).toBeTruthy();
    });

    mockInvoke.mockClear();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(makeSettings());
      return Promise.resolve(undefined);
    });

    const unhideBtn = document.querySelector(
      '.hidden-pr-remove:not(.follow-pr-remove)[data-pr-url]'
    ) as HTMLElement;
    unhideBtn.click();

    expect(mockState.hiddenPrs.has("https://github.com/org/repo/pull/5")).toBe(false);

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", expect.anything());
    });
  });

  // ── Tab switching ─────────────────────────────────────────────────────

  it("tab switching: clicking a tab renders new content and updates active class", async () => {
    await showSettings();

    // General tab is active initially
    const generalTab = document.querySelector('[data-tab="general"]') as HTMLElement;
    expect(generalTab.classList.contains("active")).toBe(true);

    // Switch to workflow tab
    const workflowTab = document.querySelector('[data-tab="workflow"]') as HTMLElement;
    workflowTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("setting-workflow-enabled")).toBeTruthy();
    });

    expect(workflowTab.classList.contains("active")).toBe(true);
    expect(generalTab.classList.contains("active")).toBe(false);

    // General tab content should be gone
    expect(document.getElementById("setting-poll")).toBeNull();
  });

  it("tab switching: sets settings nav index", async () => {
    await showSettings();

    expect(mockState.setSettingsNavIndex).toHaveBeenCalledWith(0); // initial

    const notifTab = document.querySelector('[data-tab="notifications"]') as HTMLElement;
    notifTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("notif-master")).toBeTruthy();
    });

    expect(mockState.setSettingsNavIndex).toHaveBeenCalledWith(1);
    expect(mockState.setSettingsGroupIndex).toHaveBeenCalledWith(-1);
  });

  it("subscriptions tab: pressing Enter in user input triggers add", async () => {
    await showSettings();

    const subTab = document.querySelector('[data-tab="subscriptions"]') as HTMLElement;
    subTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("follow-user-input")).toBeTruthy();
    });

    const input = document.getElementById("follow-user-input") as HTMLInputElement;
    input.value = "enteruser";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(mockState.followedUsers).toContain("enteruser");
  });

  it("subscriptions tab: pressing Enter in PR input triggers add", async () => {
    await showSettings();

    const subTab = document.querySelector('[data-tab="subscriptions"]') as HTMLElement;
    subTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("follow-pr-input")).toBeTruthy();
    });

    const input = document.getElementById("follow-pr-input") as HTMLInputElement;
    input.value = "https://github.com/org/repo/pull/77";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(mockState.followedPrs.has("https://github.com/org/repo/pull/77")).toBe(true);
  });

  it("subscriptions tab: empty input does not add user", async () => {
    await showSettings();

    const subTab = document.querySelector('[data-tab="subscriptions"]') as HTMLElement;
    subTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("follow-user-input")).toBeTruthy();
    });

    const addBtn = document.getElementById("follow-user-add") as HTMLButtonElement;
    const input = document.getElementById("follow-user-input") as HTMLInputElement;
    input.value = "";
    addBtn.click();

    expect(mockState.followedUsers.length).toBe(0);
  });

  it("subscriptions tab: empty input does not add PR", async () => {
    await showSettings();

    const subTab = document.querySelector('[data-tab="subscriptions"]') as HTMLElement;
    subTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("follow-pr-input")).toBeTruthy();
    });

    const addBtn = document.getElementById("follow-pr-add") as HTMLButtonElement;
    const input = document.getElementById("follow-pr-input") as HTMLInputElement;
    input.value = "   ";
    addBtn.click();

    expect(mockState.followedPrs.size).toBe(0);
  });

  // ── Shortcuts tab - key capture ──────────────────────────────────────────

  it("shortcuts tab: clicking in-app shortcut button starts key capture", async () => {
    await showSettings();

    const kbTab = document.querySelector('[data-tab="shortcuts"]') as HTMLElement;
    kbTab.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-action="navigate_down"]')).toBeTruthy();
    });

    const btn = document.querySelector('[data-action="navigate_down"]') as HTMLElement;
    btn.click();

    expect(btn.classList.contains("capturing")).toBe(true);
    expect(btn.textContent).toBe("press key…");
  });

  it("shortcuts tab: pressing a key after capture updates button and calls setKeybindings", async () => {
    await showSettings();

    const kbTab = document.querySelector('[data-tab="shortcuts"]') as HTMLElement;
    kbTab.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-action="navigate_down"]')).toBeTruthy();
    });

    mockInvoke.mockClear();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(makeSettings());
      return Promise.resolve(undefined);
    });

    const btn = document.querySelector('[data-action="navigate_down"]') as HTMLElement;
    btn.click();

    // Dispatch a keydown event to complete capture
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));

    expect(btn.classList.contains("capturing")).toBe(false);
    expect(btn.textContent).toBe("X"); // formatKeybinding("x") -> "X"
    expect(mockState.setKeybindings).toHaveBeenCalledWith({ navigate_down: "x" });

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", expect.anything());
    });
  });

  it("shortcuts tab: space key is captured as 'Space'", async () => {
    await showSettings();

    const kbTab = document.querySelector('[data-tab="shortcuts"]') as HTMLElement;
    kbTab.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-action="navigate_up"]')).toBeTruthy();
    });

    const btn = document.querySelector('[data-action="navigate_up"]') as HTMLElement;
    btn.click();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));

    expect(btn.textContent).toBe("SPACE"); // formatKeybinding("Space") -> "SPACE"
    expect(mockState.setKeybindings).toHaveBeenCalledWith({ navigate_up: "Space" });
  });

  it("shortcuts tab: Enter key is captured as 'Enter'", async () => {
    await showSettings();

    const kbTab = document.querySelector('[data-tab="shortcuts"]') as HTMLElement;
    kbTab.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-action="expand"]')).toBeTruthy();
    });

    const btn = document.querySelector('[data-action="expand"]') as HTMLElement;
    btn.click();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(btn.textContent).toBe("\u23CE"); // formatKeybinding("Enter") -> "⏎"
    expect(mockState.setKeybindings).toHaveBeenCalledWith({ expand: "Enter" });
  });

  // ── Shortcuts tab - global shortcut capture ──────────────────────────────

  it("shortcuts tab: clicking global shortcut button starts global capture", async () => {
    await showSettings();

    const kbTab = document.querySelector('[data-tab="shortcuts"]') as HTMLElement;
    kbTab.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-action="global_toggle"]')).toBeTruthy();
    });

    const btn = document.querySelector('[data-action="global_toggle"]') as HTMLElement;
    btn.click();

    expect(btn.classList.contains("capturing")).toBe(true);
    expect(btn.textContent).toBe("press key with modifiers…");
  });

  it("shortcuts tab: pressing modifier-only key stays in capturing mode", async () => {
    await showSettings();

    const kbTab = document.querySelector('[data-tab="shortcuts"]') as HTMLElement;
    kbTab.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-action="global_toggle"]')).toBeTruthy();
    });

    const btn = document.querySelector('[data-action="global_toggle"]') as HTMLElement;
    btn.click();

    // Press Meta alone - should stay in capturing mode
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta", metaKey: true }));

    expect(btn.classList.contains("capturing")).toBe(true);
    expect(btn.textContent).toBe("press key with modifiers…");
  });

  it("shortcuts tab: Cmd+Shift+P captures as 'Super+Shift+P'", async () => {
    await showSettings();

    const kbTab = document.querySelector('[data-tab="shortcuts"]') as HTMLElement;
    kbTab.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-action="global_toggle"]')).toBeTruthy();
    });

    mockInvoke.mockClear();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(makeSettings());
      return Promise.resolve(undefined);
    });

    const btn = document.querySelector('[data-action="global_toggle"]') as HTMLElement;
    btn.click();

    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "p",
      metaKey: true,
      shiftKey: true,
    }));

    expect(btn.classList.contains("capturing")).toBe(false);
    expect(btn.textContent).toBe("Super+Shift+P");

    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("update_settings", expect.anything());
    });
  });

  it("shortcuts tab: pressing key with no modifiers captures just the key", async () => {
    await showSettings();

    const kbTab = document.querySelector('[data-tab="shortcuts"]') as HTMLElement;
    kbTab.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-action="global_reload"]')).toBeTruthy();
    });

    const btn = document.querySelector('[data-action="global_reload"]') as HTMLElement;
    btn.click();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));

    expect(btn.classList.contains("capturing")).toBe(false);
    expect(btn.textContent).toBe("K");
  });

  // ── General tab - merged/closed tab button visibility ────────────────────

  it("general tab: toggling 'show merged' shows merged tab button", async () => {
    // Add tab buttons outside #content (as they exist in the real DOM)
    document.body.innerHTML = `
      <div id="content"></div>
      <button data-tab="merged" style="display:none">Merged</button>
      <button data-tab="closed" style="display:none">Closed</button>
    `;

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(makeSettings({ show_recently_merged: false }));
      return Promise.resolve(undefined);
    });

    await showSettings();

    const mergedEl = document.getElementById("setting-merged") as HTMLInputElement;
    const mergedBtn = document.querySelector('[data-tab="merged"]') as HTMLElement;

    // Check the merged toggle
    mergedEl.checked = true;
    mergedEl.dispatchEvent(new Event("change"));

    expect(mergedBtn.style.display).toBe("");
  });

  it("general tab: unchecking 'show merged' hides merged tab button", async () => {
    document.body.innerHTML = `
      <div id="content"></div>
      <button data-tab="merged">Merged</button>
      <button data-tab="closed" style="display:none">Closed</button>
    `;

    await showSettings();

    const mergedEl = document.getElementById("setting-merged") as HTMLInputElement;
    const mergedBtn = document.querySelector('[data-tab="merged"]') as HTMLElement;

    // Uncheck the merged toggle
    mergedEl.checked = false;
    mergedEl.dispatchEvent(new Event("change"));

    expect(mergedBtn.style.display).toBe("none");
  });

  it("general tab: toggling 'show closed' shows/hides closed tab button", async () => {
    document.body.innerHTML = `
      <div id="content"></div>
      <button data-tab="merged" style="display:none">Merged</button>
      <button data-tab="closed" style="display:none">Closed</button>
    `;

    await showSettings();

    const closedEl = document.getElementById("setting-closed") as HTMLInputElement;
    const closedBtn = document.querySelector('[data-tab="closed"]') as HTMLElement;

    // Check the closed toggle
    closedEl.checked = true;
    closedEl.dispatchEvent(new Event("change"));

    expect(closedBtn.style.display).toBe("");

    // Uncheck
    closedEl.checked = false;
    closedEl.dispatchEvent(new Event("change"));

    expect(closedBtn.style.display).toBe("none");
  });

  // ── Notifications tab - merged/closed toggles ───────────────────────────

  it("notifications tab: toggling notif-merged updates state and auto-saves", async () => {
    loadNotifPrefsFromSettings(makeSettings({ notify_on_merged: true }));
    await showSettings();

    const notifTab = document.querySelector('[data-tab="notifications"]') as HTMLElement;
    notifTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("notif-merged")).toBeTruthy();
    });

    mockInvoke.mockClear();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(makeSettings());
      return Promise.resolve(undefined);
    });

    const mergedEl = document.getElementById("notif-merged") as HTMLInputElement;
    mergedEl.checked = false;
    mergedEl.dispatchEvent(new Event("change"));

    await vi.waitFor(() => {
      const updateCall = mockInvoke.mock.calls.find((c) => c[0] === "update_settings");
      expect(updateCall).toBeTruthy();
      expect((updateCall![1] as { settings: Settings }).settings.notify_on_merged).toBe(false);
    });
  });

  it("notifications tab: toggling notif-closed updates state and auto-saves", async () => {
    loadNotifPrefsFromSettings(makeSettings({ notify_on_closed: false }));
    await showSettings();

    const notifTab = document.querySelector('[data-tab="notifications"]') as HTMLElement;
    notifTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("notif-closed")).toBeTruthy();
    });

    mockInvoke.mockClear();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(makeSettings());
      return Promise.resolve(undefined);
    });

    const closedEl = document.getElementById("notif-closed") as HTMLInputElement;
    closedEl.checked = true;
    closedEl.dispatchEvent(new Event("change"));

    await vi.waitFor(() => {
      const updateCall = mockInvoke.mock.calls.find((c) => c[0] === "update_settings");
      expect(updateCall).toBeTruthy();
      expect((updateCall![1] as { settings: Settings }).settings.notify_on_closed).toBe(true);
    });
  });

  // ── Updates tab - brew interval ─────────────────────────────────────────

  it("updates tab: changing brew interval updates value and auto-saves", async () => {
    loadNotifPrefsFromSettings(makeSettings({
      homebrew_check_enabled: true,
      homebrew_check_interval_secs: 14400,
    }));
    await showSettings();

    const updatesTab = document.querySelector('[data-tab="updates"]') as HTMLElement;
    updatesTab.click();
    await vi.waitFor(() => {
      expect(document.getElementById("setting-brew-interval")).toBeTruthy();
    });

    mockInvoke.mockClear();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_settings") return Promise.resolve(makeSettings());
      return Promise.resolve(undefined);
    });

    const intervalSelect = document.getElementById("setting-brew-interval") as HTMLSelectElement;
    intervalSelect.value = "86400";
    intervalSelect.dispatchEvent(new Event("change"));

    await vi.waitFor(() => {
      const updateCall = mockInvoke.mock.calls.find((c) => c[0] === "update_settings");
      expect(updateCall).toBeTruthy();
      expect((updateCall![1] as { settings: Settings }).settings.homebrew_check_interval_secs).toBe(86400);
    });
  });
});
