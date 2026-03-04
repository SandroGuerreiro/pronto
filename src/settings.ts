import { invoke } from "@tauri-apps/api/core";
import type { Settings, NotificationPreferences } from "./types";
import {
  favoriteOrgs,
  favoriteRepos,
  collapsedAccordions,
  hiddenOrgs,
  hiddenRepos,
  hiddenPrs,
  followedUsers,
  followedPrs,
  setGroupByRepository,
  setFollowedUsers,
  activeFollowFilter,
  setActiveFollowFilter,
  keybindings,
  setKeybindings,
  setShowRecentlyMerged,
  setShowClosed,
} from "./state";

// Injected callback: called when settings view is closed (wired in main.ts)
let _onSettingsClosed: () => void = () => {};

// ── Notification preferences state ────────────────────────────────────────
// Kept at module level so autoSaveSettings always has the latest values,
// even when the notifications tab is not currently rendered.

const defaultNotifPrefs = (): NotificationPreferences => ({
  review_required: false,
  changes_requested: false,
  approved: false,
  checks_failed: false,
  checks_recovered: false,
  kicked_from_queue: false,
  new_comment: false,
});

let _notifPrefsOwned: NotificationPreferences = defaultNotifPrefs();
let _notifPrefsFollowed: NotificationPreferences = defaultNotifPrefs();
let _notifyOnMerged: boolean = true;
let _notifyOnClosed: boolean = false;

export function loadNotifPrefsFromSettings(s: Settings) {
  _notifPrefsOwned = { ...defaultNotifPrefs(), ...s.notification_prefs_owned };
  _notifPrefsFollowed = { ...defaultNotifPrefs(), ...s.notification_prefs_followed };
  _notifyOnMerged = s.notify_on_merged ?? true;
  _notifyOnClosed = s.notify_on_closed ?? false;
}

export function initSettings(onClosed: () => void) {
  _onSettingsClosed = onClosed;
}

export function hideSettings() {
  _onSettingsClosed();
}

// ── Auto-save ─────────────────────────────────────────────────────────────

export async function autoSaveSettings() {
  // Load current settings from Rust to preserve values not on current tab
  const currentSettings = await invoke<Settings>("get_settings");

  const pollEl = document.getElementById("setting-poll") as HTMLSelectElement | null;
  const notifEl = document.getElementById("setting-notifications") as HTMLInputElement | null;
  const mergedEl = document.getElementById("setting-merged") as HTMLInputElement | null;
  const mergedHoursEl = document.getElementById("setting-merged-hours") as HTMLSelectElement | null;
  const closedEl = document.getElementById("setting-closed") as HTMLInputElement | null;
  const closedHoursEl = document.getElementById("setting-closed-hours") as HTMLSelectElement | null;
  const groupRepoEl = document.getElementById("setting-group-repo") as HTMLInputElement | null;
  const wfEnabledEl = document.getElementById("setting-workflow-enabled") as HTMLInputElement | null;
  const wfOrgEl = document.getElementById("setting-workflow-org") as HTMLInputElement | null;
  const wfRepoEl = document.getElementById("setting-workflow-repo") as HTMLInputElement | null;
  const wfNameEl = document.getElementById("setting-workflow-name") as HTMLInputElement | null;
  const globalToggleEl = document.querySelector('[data-action="global_toggle"]') as HTMLElement | null;
  const globalReloadEl = document.querySelector('[data-action="global_reload"]') as HTMLElement | null;

  // Collect keybindings from state
  const kbToSave = { ...keybindings };

  const updated: Settings = {
    poll_interval_secs: pollEl ? parseInt(pollEl.value) : currentSettings.poll_interval_secs,
    notifications_enabled: notifEl?.checked ?? currentSettings.notifications_enabled,
    show_recently_merged: mergedEl?.checked ?? currentSettings.show_recently_merged,
    merged_window_hours: mergedHoursEl ? parseInt(mergedHoursEl.value) : currentSettings.merged_window_hours,
    show_closed: closedEl?.checked ?? currentSettings.show_closed,
    closed_window_hours: closedHoursEl ? parseInt(closedHoursEl.value) : currentSettings.closed_window_hours,
    favorite_orgs: [...favoriteOrgs],
    favorite_repos: [...favoriteRepos],
    collapsed_accordions: [...collapsedAccordions],
    hidden_orgs: [...hiddenOrgs],
    hidden_repos: [...hiddenRepos],
    hidden_prs: [...hiddenPrs.entries()].map(([url, title]) => ({ url, title })),
    followed_users: followedUsers,
    followed_prs: [...followedPrs],
    group_by_repository: groupRepoEl?.checked ?? currentSettings.group_by_repository,
    workflow_monitor_enabled: wfEnabledEl?.checked ?? currentSettings.workflow_monitor_enabled,
    workflow_org: wfOrgEl?.value.trim() ?? currentSettings.workflow_org,
    workflow_repo: wfRepoEl?.value.trim() ?? currentSettings.workflow_repo,
    workflow_name: wfNameEl?.value.trim() ?? currentSettings.workflow_name,
    keybindings: kbToSave,
    global_toggle_shortcut: globalToggleEl?.textContent ?? currentSettings.global_toggle_shortcut,
    global_reload_shortcut: globalReloadEl?.textContent ?? currentSettings.global_reload_shortcut,
    // Use module-level state — always current regardless of which tab is rendered
    notification_prefs_owned: { ..._notifPrefsOwned },
    notification_prefs_followed: { ..._notifPrefsFollowed },
    notify_on_merged: _notifyOnMerged,
    notify_on_closed: _notifyOnClosed,
  };

  setGroupByRepository(updated.group_by_repository);
  await invoke("update_settings", { settings: updated });
}

// ── Key capture helper ────────────────────────────────────────────────────

function formatKeybinding(key: string): string {
  // Convert special keys to display format
  if (key === "Enter") return "⏎";
  if (key === " ") return "Space";
  return key.toUpperCase();
}

function startKeyCapture(
  element: HTMLElement,
  onCapture: (key: string) => void
) {
  element.classList.add("capturing");
  element.textContent = "press key…";

  const handler = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    document.removeEventListener("keydown", handler);
    element.classList.remove("capturing");

    // Capture the key name
    let key = e.key;
    if (key === " ") key = "Space";
    if (key === "Enter") key = "Enter";

    onCapture(key);
  };

  document.addEventListener("keydown", handler);
}

function startGlobalShortcutCapture(
  element: HTMLElement,
  onCapture: (shortcut: string) => void
) {
  element.classList.add("capturing");
  element.textContent = "press key with modifiers…";

  const handler = (e: KeyboardEvent) => {
    // Ignore pure modifier key presses
    const isModifierOnly = ["Meta", "Control", "Shift", "Alt"].includes(e.key);
    if (isModifierOnly) {
      return; // Keep waiting for an actual key
    }

    e.preventDefault();
    e.stopPropagation();

    document.removeEventListener("keydown", handler);
    element.classList.remove("capturing");

    // Build shortcut string from modifiers and key
    const parts: string[] = [];

    // On macOS, Cmd is represented as Meta in KeyboardEvent
    if (e.metaKey) parts.push("Super");
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey) parts.push("Alt");

    let key = e.key.toUpperCase();
    // Handle special keys
    if (key === " ") key = "Space";
    else if (key === "ENTER") key = "Enter";

    parts.push(key);

    const shortcut = parts.join("+");
    onCapture(shortcut);
  };

  document.addEventListener("keydown", handler);
}

// ── Show settings ─────────────────────────────────────────────────────────

export async function showSettings() {
  const content = document.getElementById("content")!;

  content.innerHTML = `
    <div class="settings-view">
      <div class="settings-sidebar">
        <button class="settings-tab active" data-tab="general">⚙<span>General</span></button>
        <button class="settings-tab" data-tab="display">▤<span>Display</span></button>
        <button class="settings-tab" data-tab="notifications">🔔<span>Notifications</span></button>
        <button class="settings-tab" data-tab="workflow">⚡<span>Workflow</span></button>
        <button class="settings-tab" data-tab="shortcuts">⌨<span>Keys</span></button>
        <button class="settings-tab" data-tab="subscriptions">📌<span>Subscriptions</span></button>
      </div>
      <div class="settings-content">
        <!-- Tab content rendered here -->
      </div>
    </div>
  `;

  const contentArea = document.querySelector(".settings-content") as HTMLElement;
  let freshSettings = await invoke<Settings>("get_settings");

  // Render tab function
  async function renderTab(tabName: string) {
    // Refresh settings before rendering each tab
    freshSettings = await invoke<Settings>("get_settings");

    switch (tabName) {
      case "general":
        contentArea.innerHTML = `
          <div class="settings-section">
            <div class="settings-section-title">General</div>
            <div class="settings-group">
              <label class="settings-label">Polling interval</label>
              <select id="setting-poll" class="settings-select">
                <option value="60"${freshSettings.poll_interval_secs === 60 ? " selected" : ""}>1 minute</option>
                <option value="120"${freshSettings.poll_interval_secs === 120 ? " selected" : ""}>2 minutes</option>
                <option value="300"${freshSettings.poll_interval_secs === 300 ? " selected" : ""}>5 minutes</option>
                <option value="600"${freshSettings.poll_interval_secs === 600 ? " selected" : ""}>10 minutes</option>
              </select>
            </div>
            <div class="settings-group">
              <label class="settings-label">
                <span>Notifications</span>
                <input type="checkbox" id="setting-notifications" class="settings-toggle"${freshSettings.notifications_enabled ? " checked" : ""} />
              </label>
            </div>
          </div>
        `;
        setupEventListeners();
        break;

      case "display":
        contentArea.innerHTML = `
          <div class="settings-section">
            <div class="settings-section-title">Display</div>
            <div class="settings-group">
              <label class="settings-label">
                <span>Group by repository</span>
                <input type="checkbox" id="setting-group-repo" class="settings-toggle"${freshSettings.group_by_repository !== false ? " checked" : ""} />
              </label>
            </div>
            <div class="settings-group">
              <label class="settings-label">
                <span>Show recently merged</span>
                <input type="checkbox" id="setting-merged" class="settings-toggle"${freshSettings.show_recently_merged ? " checked" : ""} />
              </label>
            </div>
            <div class="settings-group" id="merged-window-group"${freshSettings.show_recently_merged ? "" : ' style="display:none"'}>
              <label class="settings-label">Merged time window</label>
              <select id="setting-merged-hours" class="settings-select">
                <option value="12"${freshSettings.merged_window_hours === 12 ? " selected" : ""}>12 hours</option>
                <option value="24"${freshSettings.merged_window_hours === 24 ? " selected" : ""}>24 hours</option>
                <option value="48"${freshSettings.merged_window_hours === 48 ? " selected" : ""}>48 hours</option>
              </select>
            </div>
            <div class="settings-group">
              <label class="settings-label">
                <span>Show recently closed</span>
                <input type="checkbox" id="setting-closed" class="settings-toggle"${freshSettings.show_closed ? " checked" : ""} />
              </label>
            </div>
            <div class="settings-group" id="closed-window-group"${freshSettings.show_closed ? "" : ' style="display:none"'}>
              <label class="settings-label">Closed time window</label>
              <select id="setting-closed-hours" class="settings-select">
                <option value="12"${freshSettings.closed_window_hours === 12 ? " selected" : ""}>12 hours</option>
                <option value="24"${freshSettings.closed_window_hours === 24 ? " selected" : ""}>24 hours</option>
                <option value="48"${freshSettings.closed_window_hours === 48 ? " selected" : ""}>48 hours</option>
              </select>
            </div>
          </div>
        `;
        setupEventListeners();
        document.getElementById("setting-merged")!.addEventListener("change", (e) => {
          const checked = (e.target as HTMLInputElement).checked;
          document.getElementById("merged-window-group")!.style.display = checked ? "" : "none";
          const mergedBtn = document.querySelector('[data-tab="merged"]') as HTMLElement | null;
          if (mergedBtn) {
            mergedBtn.style.display = checked ? "" : "none";
          }
          setShowRecentlyMerged(checked);
          autoSaveSettings();
        });
        document.getElementById("setting-closed")!.addEventListener("change", (e) => {
          const checked = (e.target as HTMLInputElement).checked;
          document.getElementById("closed-window-group")!.style.display = checked ? "" : "none";
          const closedBtn = document.querySelector('[data-tab="closed"]') as HTMLElement | null;
          if (closedBtn) {
            closedBtn.style.display = checked ? "" : "none";
          }
          setShowClosed(checked);
          autoSaveSettings();
        });
        break;

      case "notifications":
        contentArea.innerHTML = `
          <div class="settings-section">
            <div class="settings-section-title">Owned PRs</div>
            <div class="settings-group">
              <label class="settings-label">
                <div>
                  <span>Changes requested</span>
                  <div class="settings-hint">A reviewer asked you to make changes</div>
                </div>
                <input type="checkbox" id="notif-owned-changes_requested" class="settings-toggle"${_notifPrefsOwned.changes_requested ? " checked" : ""} />
              </label>
            </div>
            <div class="settings-group">
              <label class="settings-label">
                <div>
                  <span>PR approved</span>
                  <div class="settings-hint">Your PR received all needed approvals</div>
                </div>
                <input type="checkbox" id="notif-owned-approved" class="settings-toggle"${_notifPrefsOwned.approved ? " checked" : ""} />
              </label>
            </div>
            <div class="settings-group">
              <label class="settings-label">
                <div>
                  <span>CI failed</span>
                  <div class="settings-hint">Checks went from passing to failing</div>
                </div>
                <input type="checkbox" id="notif-owned-checks_failed" class="settings-toggle"${_notifPrefsOwned.checks_failed ? " checked" : ""} />
              </label>
            </div>
            <div class="settings-group">
              <label class="settings-label">
                <div>
                  <span>CI passed</span>
                  <div class="settings-hint">Checks recovered — your PR may be ready to merge</div>
                </div>
                <input type="checkbox" id="notif-owned-checks_recovered" class="settings-toggle"${_notifPrefsOwned.checks_recovered ? " checked" : ""} />
              </label>
            </div>
            <div class="settings-group">
              <label class="settings-label">
                <div>
                  <span>Kicked from merge queue</span>
                  <div class="settings-hint">PR was removed from the queue — needs to be re-added</div>
                </div>
                <input type="checkbox" id="notif-owned-kicked_from_queue" class="settings-toggle"${_notifPrefsOwned.kicked_from_queue ? " checked" : ""} />
              </label>
            </div>
            <div class="settings-group">
              <label class="settings-label">
                <div>
                  <span>New comment</span>
                  <div class="settings-hint">Someone added a review comment or thread</div>
                </div>
                <input type="checkbox" id="notif-owned-new_comment" class="settings-toggle"${_notifPrefsOwned.new_comment ? " checked" : ""} />
              </label>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-title">Followed PRs</div>
            <div class="settings-group">
              <label class="settings-label">
                <div>
                  <span>Needs review</span>
                  <div class="settings-hint">PR is waiting for a review decision</div>
                </div>
                <input type="checkbox" id="notif-followed-review_required" class="settings-toggle"${_notifPrefsFollowed.review_required ? " checked" : ""} />
              </label>
            </div>
            <div class="settings-group">
              <label class="settings-label">
                <div>
                  <span>Changes requested</span>
                  <div class="settings-hint">A reviewer blocked the PR</div>
                </div>
                <input type="checkbox" id="notif-followed-changes_requested" class="settings-toggle"${_notifPrefsFollowed.changes_requested ? " checked" : ""} />
              </label>
            </div>
            <div class="settings-group">
              <label class="settings-label">
                <div>
                  <span>PR approved</span>
                  <div class="settings-hint">PR received all needed approvals</div>
                </div>
                <input type="checkbox" id="notif-followed-approved" class="settings-toggle"${_notifPrefsFollowed.approved ? " checked" : ""} />
              </label>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-title">Recently Merged</div>
            <div class="settings-group">
              <label class="settings-label">
                <span>Notify when merged</span>
                <input type="checkbox" id="notif-merged" class="settings-toggle"${_notifyOnMerged ? " checked" : ""} />
              </label>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-title">Recently Closed</div>
            <div class="settings-group">
              <label class="settings-label">
                <span>Notify when closed</span>
                <input type="checkbox" id="notif-closed" class="settings-toggle"${_notifyOnClosed ? " checked" : ""} />
              </label>
            </div>
          </div>
        `;

        // Wire up owned/followed checkboxes
        type NotifKey = keyof NotificationPreferences;
        const notifMap: Array<{ id: string; key: NotifKey; state: NotificationPreferences }> = [
          { id: "notif-owned-changes_requested",  key: "changes_requested", state: _notifPrefsOwned },
          { id: "notif-owned-approved",           key: "approved",          state: _notifPrefsOwned },
          { id: "notif-owned-checks_failed",        key: "checks_failed",       state: _notifPrefsOwned },
          { id: "notif-owned-checks_recovered",   key: "checks_recovered",    state: _notifPrefsOwned },
          { id: "notif-owned-kicked_from_queue",  key: "kicked_from_queue",   state: _notifPrefsOwned },
          { id: "notif-owned-new_comment",        key: "new_comment",         state: _notifPrefsOwned },
          { id: "notif-followed-review_required", key: "review_required",   state: _notifPrefsFollowed },
          { id: "notif-followed-changes_requested", key: "changes_requested", state: _notifPrefsFollowed },
          { id: "notif-followed-approved",        key: "approved",          state: _notifPrefsFollowed },
        ];

        for (const { id, key, state } of notifMap) {
          const el = document.getElementById(id) as HTMLInputElement | null;
          if (el) {
            el.addEventListener("change", () => {
              state[key] = el.checked;
              autoSaveSettings();
            });
          }
        }

        // Wire up merged/closed toggles
        const mergedEl = document.getElementById("notif-merged") as HTMLInputElement | null;
        if (mergedEl) {
          mergedEl.addEventListener("change", () => {
            _notifyOnMerged = mergedEl.checked;
            autoSaveSettings();
          });
        }
        const closedEl = document.getElementById("notif-closed") as HTMLInputElement | null;
        if (closedEl) {
          closedEl.addEventListener("change", () => {
            _notifyOnClosed = closedEl.checked;
            autoSaveSettings();
          });
        }
        break;

      case "workflow":
        contentArea.innerHTML = `
          <div class="settings-section">
            <div class="settings-section-title">Workflow</div>
            <div class="settings-group">
              <label class="settings-label">
                <span>Monitor workflow</span>
                <input type="checkbox" id="setting-workflow-enabled" class="settings-toggle"${freshSettings.workflow_monitor_enabled ? " checked" : ""} />
              </label>
            </div>
            <div id="workflow-config-group"${freshSettings.workflow_monitor_enabled ? "" : ' style="display:none"'}>
              <div class="settings-group">
                <label class="settings-label">Organization</label>
                <input type="text" id="setting-workflow-org" class="settings-input" value="${freshSettings.workflow_org || ""}" placeholder="e.g. my-org" autocapitalize="off" autocorrect="off" spellcheck="false" />
              </div>
              <div class="settings-group">
                <label class="settings-label">Repository</label>
                <input type="text" id="setting-workflow-repo" class="settings-input" value="${freshSettings.workflow_repo || ""}" placeholder="e.g. recharge-v2" autocapitalize="off" autocorrect="off" spellcheck="false" />
              </div>
              <div class="settings-group">
                <label class="settings-label">Workflow file</label>
                <input type="text" id="setting-workflow-name" class="settings-input" value="${freshSettings.workflow_name || ""}" placeholder="e.g. deploy.yml" autocapitalize="off" autocorrect="off" spellcheck="false" />
              </div>
            </div>
          </div>
        `;
        setupEventListeners();
        document.getElementById("setting-workflow-enabled")!.addEventListener("change", (e) => {
          const checked = (e.target as HTMLInputElement).checked;
          document.getElementById("workflow-config-group")!.style.display = checked ? "" : "none";
          autoSaveSettings();
        });
        break;

      case "shortcuts":
        contentArea.innerHTML = `
          <div class="settings-section">
            <div class="settings-section-title">Global shortcuts</div>
            <div class="kb-table">
              <div class="kb-row">
                <span class="kb-label">Toggle popup</span>
                <button class="kb-key global-kb-key" data-action="global_toggle">${freshSettings.global_toggle_shortcut || "Super+Ctrl+P"}</button>
              </div>
              <div class="kb-row">
                <span class="kb-label">Reload</span>
                <button class="kb-key global-kb-key" data-action="global_reload">${freshSettings.global_reload_shortcut || "Super+Ctrl+R"}</button>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-title">In-app shortcuts</div>
            <div class="kb-table">
              <div class="kb-row">
                <span class="kb-label">Navigate down</span>
                <button class="kb-key" data-action="navigate_down">${formatKeybinding(keybindings.navigate_down)}</button>
              </div>
              <div class="kb-row">
                <span class="kb-label">Navigate up</span>
                <button class="kb-key" data-action="navigate_up">${formatKeybinding(keybindings.navigate_up)}</button>
              </div>
              <div class="kb-row">
                <span class="kb-label">Expand</span>
                <button class="kb-key" data-action="expand">${formatKeybinding(keybindings.expand)}</button>
              </div>
              <div class="kb-row">
                <span class="kb-label">Collapse</span>
                <button class="kb-key" data-action="collapse">${formatKeybinding(keybindings.collapse)}</button>
              </div>
              <div class="kb-row">
                <span class="kb-label">Open PR</span>
                <button class="kb-key" data-action="open_pr">${formatKeybinding(keybindings.open_pr)}</button>
              </div>
              <div class="kb-row">
                <span class="kb-label">Hide PR</span>
                <button class="kb-key" data-action="hide_pr">${formatKeybinding(keybindings.hide_pr)}</button>
              </div>
              <div class="kb-row">
                <span class="kb-label">Copy URL</span>
                <button class="kb-key" data-action="copy_url">${formatKeybinding(keybindings.copy_url)}</button>
              </div>
              <div class="kb-row">
                <span class="kb-label">Tab: Owned</span>
                <button class="kb-key" data-action="tab_owned">${formatKeybinding(keybindings.tab_owned)}</button>
              </div>
              <div class="kb-row">
                <span class="kb-label">Tab: Followed</span>
                <button class="kb-key" data-action="tab_followed">${formatKeybinding(keybindings.tab_followed)}</button>
              </div>
              <div class="kb-row">
                <span class="kb-label">Tab: Merged</span>
                <button class="kb-key" data-action="tab_merged">${formatKeybinding(keybindings.tab_merged)}</button>
              </div>
              <div class="kb-row">
                <span class="kb-label">Tab: Closed</span>
                <button class="kb-key" data-action="tab_closed">${formatKeybinding(keybindings.tab_closed)}</button>
              </div>
            </div>
          </div>
        `;
        setupKeybindingListeners();
        break;

      case "subscriptions":
        renderSubscriptionsTab();
        break;
    }
  }

  function setupEventListeners() {
    contentArea.querySelectorAll("input, select").forEach((input) => {
      input.addEventListener("change", autoSaveSettings);
    });
  }

  function setupKeybindingListeners() {
    // Setup in-app shortcuts
    contentArea.querySelectorAll(".kb-key:not(.global-kb-key)").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action")!;
        startKeyCapture(btn as HTMLElement, (key: string) => {
          setKeybindings({ [action]: key });
          (btn as HTMLElement).textContent = formatKeybinding(key);
          autoSaveSettings();
        });
      });
    });

    // Setup global shortcuts
    contentArea.querySelectorAll(".global-kb-key").forEach((btn) => {
      btn.addEventListener("click", () => {
        startGlobalShortcutCapture(btn as HTMLElement, (shortcut: string) => {
          (btn as HTMLElement).textContent = shortcut;
          autoSaveSettings();
        });
      });
    });
  }

  function renderSubscriptionsTab() {
    contentArea.innerHTML = `
      <div class="settings-section">
        <div class="settings-section-title">Followed users</div>
        <div class="settings-group">
          <label class="settings-label"><span>Add GitHub username</span></label>
          <div style="display: flex; gap: 6px;">
            <input type="text" id="follow-user-input" class="settings-input" placeholder="e.g. octocat" autocapitalize="off" autocorrect="off" spellcheck="false" />
            <button id="follow-user-add" class="login-btn" style="width:auto; padding: 8px 14px;">Add</button>
          </div>
        </div>
        <div class="hidden-prs-list" id="follow-users-list">
          ${
            freshSettings.followed_users && freshSettings.followed_users.length > 0
              ? freshSettings.followed_users
                  .map(
                    (u: string) => `
                <div class="hidden-pr-row" data-user="${u}">
                  <span class="hidden-pr-title">${u}</span>
                  <button class="hidden-pr-remove follow-user-remove" data-user="${u}" title="Remove user" aria-label="Remove user">✕</button>
                </div>`
                  )
                  .join("")
              : '<div class="hidden-prs-empty">No followed users</div>'
          }
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Followed PRs</div>
        <div class="settings-group">
          <label class="settings-label"><span>Add PR URL</span></label>
          <div style="display: flex; gap: 6px;">
            <input type="text" id="follow-pr-input" class="settings-input" placeholder="e.g. https://github.com/owner/repo/pull/123" autocapitalize="off" autocorrect="off" spellcheck="false" />
            <button id="follow-pr-add" class="login-btn" style="width:auto; padding: 8px 14px;">Add</button>
          </div>
        </div>
        <div class="hidden-prs-list" id="follow-prs-list">
          ${
            freshSettings.followed_prs && freshSettings.followed_prs.length > 0
              ? freshSettings.followed_prs
                  .map(
                    (url: string) => {
                      // Extract owner/repo/pr# from URL for shorter display
                      const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
                      const shortDisplay = match ? `${match[1]}/${match[2]} #${match[3]}` : url;
                      return `
                <div class="hidden-pr-row" data-pr-url="${url.replace(/"/g, "&quot;")}">
                  <span class="hidden-pr-title" title="${url}">${shortDisplay}</span>
                  <button class="hidden-pr-remove follow-pr-remove" data-pr-url="${url.replace(/"/g, "&quot;")}" title="Remove PR" aria-label="Remove PR">✕</button>
                </div>`;
                    }
                  )
                  .join("")
              : '<div class="hidden-prs-empty">No followed PRs</div>'
          }
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Hidden PRs</div>
        <div class="hidden-prs-list">
          ${
            hiddenPrs.size > 0
              ? [...hiddenPrs.entries()]
                  .map(
                    ([url, title]) => `
                <div class="hidden-pr-row" data-pr-url="${url.replace(/"/g, "&quot;")}">
                  <span class="hidden-pr-title">${title}</span>
                  <button class="hidden-pr-remove" data-pr-url="${url.replace(/"/g, "&quot;")}" title="Unhide PR" aria-label="Unhide PR">✕</button>
                </div>`
                  )
                  .join("")
              : '<div class="hidden-prs-empty">No hidden PRs</div>'
          }
        </div>
      </div>
    `;

    // Unhide PR buttons (hidden PRs only - not follow-pr-remove)
    contentArea.querySelectorAll<HTMLElement>(".hidden-pr-remove:not(.follow-pr-remove)[data-pr-url]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const url = btn.getAttribute("data-pr-url")!;
        hiddenPrs.delete(url);
        btn.closest(".hidden-pr-row")?.remove();
        const lists = contentArea.querySelectorAll(".hidden-prs-list");
        lists.forEach((list) => {
          if (list.querySelectorAll(".hidden-pr-row").length === 0) {
            list.innerHTML = '<div class="hidden-prs-empty">No hidden PRs</div>';
          }
        });
        autoSaveSettings();
      });
    });

    // Followed PRs list
    const followPrList = contentArea.querySelector("#follow-prs-list") as HTMLElement;
    const followPrInput = contentArea.querySelector("#follow-pr-input") as HTMLInputElement;
    const followPrAddBtn = contentArea.querySelector("#follow-pr-add") as HTMLButtonElement;

    const refreshFollowPrEmptyState = () => {
      if (!followPrList.querySelector(".hidden-pr-row")) {
        followPrList.innerHTML = '<div class="hidden-prs-empty">No followed PRs</div>';
      }
    };

    const addFollowPrRemoveListener = (btn: Element) => {
      btn.addEventListener("click", () => {
        const url = btn.getAttribute("data-pr-url")!;
        followedPrs.delete(url);
        btn.closest(".hidden-pr-row")?.remove();
        refreshFollowPrEmptyState();
        autoSaveSettings();
      });
    };

    followPrInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") followPrAddBtn.click();
    });

    followPrAddBtn.addEventListener("click", () => {
      const url = followPrInput.value.trim();
      if (!url) return;
      // Normalize: handle full URLs or short forms
      const normalizedUrl = url.startsWith("http") ? url : `https://github.com/${url}`;
      if (followedPrs.has(normalizedUrl)) {
        followPrInput.value = "";
        return;
      }
      followedPrs.add(normalizedUrl);
      followPrList.querySelector(".hidden-prs-empty")?.remove();
      const row = document.createElement("div");
      row.className = "hidden-pr-row";
      row.dataset.prUrl = normalizedUrl;
      // Extract owner/repo/pr# from URL for shorter display
      const match = normalizedUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
      const shortDisplay = match ? `${match[1]}/${match[2]} #${match[3]}` : normalizedUrl;
      row.innerHTML = `
        <span class="hidden-pr-title" title="${normalizedUrl}">${shortDisplay}</span>
        <button class="hidden-pr-remove follow-pr-remove" data-pr-url="${normalizedUrl.replace(/"/g, "&quot;")}" title="Remove PR" aria-label="Remove PR">✕</button>
      `;
      followPrList.appendChild(row);
      const newBtn = row.querySelector(".follow-pr-remove")!;
      addFollowPrRemoveListener(newBtn);
      followPrInput.value = "";
      autoSaveSettings();
    });

    followPrList.querySelectorAll(".follow-pr-remove").forEach(addFollowPrRemoveListener);

    // Followed users list
    const followList = contentArea.querySelector("#follow-users-list") as HTMLElement;
    const followInput = contentArea.querySelector("#follow-user-input") as HTMLInputElement;
    const followAddBtn = contentArea.querySelector("#follow-user-add") as HTMLButtonElement;

    const refreshFollowEmptyState = () => {
      if (!followList.querySelector(".hidden-pr-row")) {
        followList.innerHTML = '<div class="hidden-prs-empty">No followed users</div>';
      }
    };

    const addFollowRemoveListener = (btn: Element) => {
      btn.addEventListener("click", () => {
        const user = btn.getAttribute("data-user")!;
        setFollowedUsers(followedUsers.filter((u) => u !== user));
        btn.closest(".hidden-pr-row")?.remove();
        refreshFollowEmptyState();
        if (activeFollowFilter === user) setActiveFollowFilter("all");
        autoSaveSettings();
      });
    };

    followInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") followAddBtn.click();
    });

    followAddBtn.addEventListener("click", () => {
      const raw = followInput.value.trim();
      if (!raw) return;
      const user = raw.replace(/^@/, "");
      if (followedUsers.includes(user)) {
        followInput.value = "";
        return;
      }
      followedUsers.push(user);
      followList.querySelector(".hidden-prs-empty")?.remove();
      const row = document.createElement("div");
      row.className = "hidden-pr-row";
      row.dataset.user = user;
      row.innerHTML = `
        <span class="hidden-pr-title">${user}</span>
        <button class="hidden-pr-remove follow-user-remove" data-user="${user}" title="Remove user" aria-label="Remove user">✕</button>
      `;
      followList.appendChild(row);
      const newBtn = row.querySelector(".follow-user-remove")!;
      addFollowRemoveListener(newBtn);
      followInput.value = "";
      autoSaveSettings();
    });

    followList.querySelectorAll(".follow-user-remove").forEach(addFollowRemoveListener);
  }

  // Tab switching
  const tabButtons = content.querySelectorAll(".settings-tab");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      tabButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tabName = btn.getAttribute("data-tab")!;
      await renderTab(tabName);
    });
  });

  // Render initial tab
  await renderTab("general");
}
