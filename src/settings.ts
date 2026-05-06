import { invoke } from "@tauri-apps/api/core";
import type { Settings, NotificationPreferences, HomebrewStatus } from "./types";
import { setActiveTab } from "./tabs";
import {
  favoriteOrgs,
  favoriteRepos,
  collapsedAccordions,
  hiddenOrgs,
  hiddenRepos,
  hiddenPrs,
  watchedUsers,
  watchedPrs,
  setGroupByRepository,
  setWatchedUsers,
  activeWatchFilter,
  setActiveWatchFilter,
  keybindings,
  setKeybindings,
  activeTab,
  setShowRecentlyMerged,
  setShowClosed,
  setShowRequests,
  setSettingsNavIndex,
  setSettingsGroupIndex,
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
  new_comment_participated: false,
});

let _notificationSound: boolean = true;
let _notificationVolume: number = 0.35;
let _useNativeNotifications: boolean = true;
let _notifPrefsOwned: NotificationPreferences = defaultNotifPrefs();
let _notifPrefsWatched: NotificationPreferences = defaultNotifPrefs();
let _notifyOnMerged: boolean = true;
let _notifyOnClosed: boolean = false;

// ── Homebrew check preferences ────────────────────────────────────────────
let _brewCheckEnabled: boolean = false;
let _brewCheckIntervalSecs: number = 14400;

// ── Popup screen preference ──────────────────────────────────────────────
let _popupScreen: string = "primary";

// ── Auto-watch PRs you commented on ──────────────────────────────────────
let _autoWatchCommentedPrs: boolean = true;

// ── Notification duration ─────────────────────────────────────────────────
let _notificationDurationSecs: number = 8;

export function loadNotifPrefsFromSettings(s: Settings) {
  _notificationSound = s.notification_sound ?? true;
  _notificationVolume = s.notification_volume ?? 0.35;
  _notificationDurationSecs = s.notification_duration_secs ?? 8;
  _useNativeNotifications = s.use_native_notifications ?? false;
  _notifPrefsOwned = { ...defaultNotifPrefs(), ...s.notification_prefs_owned };
  _notifPrefsWatched = { ...defaultNotifPrefs(), ...s.notification_prefs_watched };
  _notifyOnMerged = s.notify_on_merged ?? true;
  _notifyOnClosed = s.notify_on_closed ?? false;
  _brewCheckEnabled = s.homebrew_check_enabled ?? false;
  _brewCheckIntervalSecs = s.homebrew_check_interval_secs ?? 14400;
  _popupScreen = s.popup_screen ?? "primary";
  _autoWatchCommentedPrs = s.auto_watch_commented_prs ?? true;
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
  const mergedEl = document.getElementById("setting-merged") as HTMLInputElement | null;
  const mergedHoursEl = document.getElementById("setting-merged-hours") as HTMLSelectElement | null;
  const closedEl = document.getElementById("setting-closed") as HTMLInputElement | null;
  const closedHoursEl = document.getElementById("setting-closed-hours") as HTMLSelectElement | null;
  const requestsEl = document.getElementById("setting-requests") as HTMLInputElement | null;
  const groupRepoEl = document.getElementById("setting-group-repo") as HTMLInputElement | null;
  const wfEnabledEl = document.getElementById("setting-workflow-enabled") as HTMLInputElement | null;
  const wfOrgEl = document.getElementById("setting-workflow-org") as HTMLInputElement | null;
  const wfRepoEl = document.getElementById("setting-workflow-repo") as HTMLInputElement | null;
  const wfNameEl = document.getElementById("setting-workflow-name") as HTMLInputElement | null;
  const globalToggleEl = document.querySelector('[data-action="global_toggle"]') as HTMLElement | null;
  const globalReloadEl = document.querySelector('[data-action="global_reload"]') as HTMLElement | null;
  const globalWatchEl = document.querySelector('[data-action="global_watch"]') as HTMLElement | null;

  // Collect keybindings from state
  const kbToSave = { ...keybindings };

  const updated: Settings = {
    poll_interval_secs: pollEl ? parseInt(pollEl.value) : currentSettings.poll_interval_secs,
    use_native_notifications: _useNativeNotifications,
    show_recently_merged: mergedEl?.checked ?? currentSettings.show_recently_merged,
    merged_window_hours: mergedHoursEl ? parseInt(mergedHoursEl.value) : currentSettings.merged_window_hours,
    show_closed: closedEl?.checked ?? currentSettings.show_closed,
    closed_window_hours: closedHoursEl ? parseInt(closedHoursEl.value) : currentSettings.closed_window_hours,
    show_requests: requestsEl?.checked ?? currentSettings.show_requests,
    favorite_orgs: [...favoriteOrgs],
    favorite_repos: [...favoriteRepos],
    collapsed_accordions: [...collapsedAccordions],
    hidden_orgs: [...hiddenOrgs],
    hidden_repos: [...hiddenRepos],
    hidden_prs: [...hiddenPrs.entries()].map(([url, title]) => ({ url, title })),
    watched_users: watchedUsers,
    watched_prs: [...watchedPrs],
    group_by_repository: groupRepoEl?.checked ?? currentSettings.group_by_repository,
    workflow_monitor_enabled: wfEnabledEl?.checked ?? currentSettings.workflow_monitor_enabled,
    workflow_org: wfOrgEl?.value.trim() ?? currentSettings.workflow_org,
    workflow_repo: wfRepoEl?.value.trim() ?? currentSettings.workflow_repo,
    workflow_name: wfNameEl?.value.trim() ?? currentSettings.workflow_name,
    keybindings: kbToSave,
    global_toggle_shortcut: globalToggleEl?.textContent ?? currentSettings.global_toggle_shortcut,
    global_reload_shortcut: globalReloadEl?.textContent ?? currentSettings.global_reload_shortcut,
    global_watch_shortcut: globalWatchEl?.textContent ?? currentSettings.global_watch_shortcut,
    // Use module-level state — always current regardless of which tab is rendered
    notification_prefs_owned: { ..._notifPrefsOwned },
    notification_prefs_watched: { ..._notifPrefsWatched },
    notify_on_merged: _notifyOnMerged,
    notify_on_closed: _notifyOnClosed,
    homebrew_check_enabled: _brewCheckEnabled,
    homebrew_check_interval_secs: _brewCheckIntervalSecs,
    popup_screen: _popupScreen,
    notification_sound: _notificationSound,
    notification_volume: _notificationVolume,
    notification_duration_secs: _notificationDurationSecs,
    auto_watch_commented_prs: _autoWatchCommentedPrs,
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
        <button class="settings-tab" data-tab="notifications">🔔<span>Notifications</span></button>
        <button class="settings-tab" data-tab="workflow">⚡<span>Workflow</span></button>
        <button class="settings-tab" data-tab="shortcuts">⌨<span>Keys</span></button>
        <button class="settings-tab" data-tab="updates">↑<span>Updates</span></button>
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
      case "general": {
        const popupScreen = freshSettings.popup_screen ?? "primary";
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
              <label class="settings-label">Open popup on</label>
              <select id="setting-popup-screen" class="settings-select">
                <option value="primary"${popupScreen === "primary" ? " selected" : ""}>Primary screen</option>
                <option value="active"${popupScreen === "active" ? " selected" : ""}>Active screen</option>
              </select>
              <span class="settings-hint">${popupScreen === "active" ? "Opens where your cursor is" : "Always opens on your main display"}</span>
            </div>
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
            <div class="settings-group">
              <label class="settings-label">
                <span>Show review requests</span>
                <input type="checkbox" id="setting-requests" class="settings-toggle"${freshSettings.show_requests ? " checked" : ""} />
              </label>
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
        document.getElementById("setting-requests")!.addEventListener("change", (e) => {
          const checked = (e.target as HTMLInputElement).checked;
          const requestsBtn = document.querySelector('[data-tab="requests"]') as HTMLElement | null;
          if (requestsBtn) {
            requestsBtn.style.display = checked ? "" : "none";
          }
          if (!checked && activeTab === "requests") setActiveTab("mine");
          setShowRequests(checked);
          autoSaveSettings();
        });
        const popupScreenEl = document.getElementById("setting-popup-screen") as HTMLSelectElement;
        popupScreenEl?.addEventListener("change", () => {
          _popupScreen = popupScreenEl.value;
          const hint = popupScreenEl.closest(".settings-group")?.querySelector(".settings-hint");
          if (hint) {
            hint.textContent = _popupScreen === "active" ? "Opens where your cursor is" : "Always opens on your main display";
          }
          autoSaveSettings();
        });
        break;
      }

      case "notifications":
        contentArea.innerHTML = `
          <div class="settings-section">
            <div class="settings-section-title">Notification type</div>
            <div class="notif-mode-toggle" role="radiogroup" aria-label="Notification mode">
            <button type="button" class="notif-mode-option${!_useNativeNotifications ? " active" : ""}" id="notif-mode-pronto" role="radio" aria-checked="${!_useNativeNotifications}">
              <img src="/icon.png" class="notif-mode-icon notif-mode-icon-img" alt="Pronto" />
              <span class="notif-mode-label">Custom</span>
            </button>
            <button type="button" class="notif-mode-option${_useNativeNotifications ? " active" : ""}" id="notif-mode-native" role="radio" aria-checked="${_useNativeNotifications}">
              <svg class="notif-mode-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C9.24 2 7 4.24 7 7v5l-2 2v1h14v-1l-2-2V7c0-2.76-2.24-5-5-5zm0 20c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2z" fill="currentColor"/>
              </svg>
              <span class="notif-mode-label">Native</span>
            </button>
          </div>
          </div>

          <div class="settings-section">
            <div class="settings-group">
              <label class="settings-label">
                <span>Duration</span>
                <select id="notif-duration" class="notif-inline-select">
                  <option value="3"${_notificationDurationSecs === 3 ? " selected" : ""}>3s</option>
                  <option value="5"${_notificationDurationSecs === 5 ? " selected" : ""}>5s</option>
                  <option value="8"${_notificationDurationSecs === 8 ? " selected" : ""}>8s</option>
                  <option value="10"${_notificationDurationSecs === 10 ? " selected" : ""}>10s</option>
                  <option value="15"${_notificationDurationSecs === 15 ? " selected" : ""}>15s</option>
                  <option value="20"${_notificationDurationSecs === 20 ? " selected" : ""}>20s</option>
                  <option value="30"${_notificationDurationSecs === 30 ? " selected" : ""}>30s</option>
                </select>
              </label>
            </div>
            <div class="settings-group">
              <label class="settings-label">
                <span>Sound</span>
                <input type="checkbox" id="notif-sound" class="settings-toggle"${_notificationSound ? " checked" : ""} />
              </label>
            </div>
            <div class="notif-volume-row${_notificationSound ? "" : " disabled"}" id="notif-volume-row">
              <label class="notif-volume-label" for="notif-volume">Volume</label>
              <input type="range" id="notif-volume" class="notif-volume-slider" min="0" max="100" value="${Math.round(_notificationVolume * 100)}" />
              <button id="notif-volume-preview" class="notif-volume-preview" title="Preview sound">&#9654;</button>
            </div>
          </div>

          <div class="notif-details" id="notif-details">
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
                    <div class="settings-hint">Checks are failing (including re-runs and new commits)</div>
                  </div>
                  <input type="checkbox" id="notif-owned-checks_failed" class="settings-toggle"${_notifPrefsOwned.checks_failed ? " checked" : ""} />
                </label>
              </div>
              <div class="settings-group">
                <label class="settings-label">
                  <div>
                    <span>CI passed</span>
                    <div class="settings-hint">Checks are passing (including after new commits)</div>
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
              <div class="settings-section-title">Watched PRs</div>
              <div class="settings-group">
                <label class="settings-label">
                  <div>
                    <span>Needs review</span>
                    <div class="settings-hint">PR is waiting for a review decision</div>
                  </div>
                  <input type="checkbox" id="notif-watched-review_required" class="settings-toggle"${_notifPrefsWatched.review_required ? " checked" : ""} />
                </label>
              </div>
              <div class="settings-group">
                <label class="settings-label">
                  <div>
                    <span>Changes requested</span>
                    <div class="settings-hint">A reviewer blocked the PR</div>
                  </div>
                  <input type="checkbox" id="notif-watched-changes_requested" class="settings-toggle"${_notifPrefsWatched.changes_requested ? " checked" : ""} />
                </label>
              </div>
              <div class="settings-group">
                <label class="settings-label">
                  <div>
                    <span>PR approved</span>
                    <div class="settings-hint">PR received all needed approvals</div>
                  </div>
                  <input type="checkbox" id="notif-watched-approved" class="settings-toggle"${_notifPrefsWatched.approved ? " checked" : ""} />
                </label>
              </div>
              <div class="settings-group">
                <label class="settings-label">
                  <div>
                    <span>Any new comments</span>
                    <div class="settings-hint">Any comment or thread reply on the PR</div>
                  </div>
                  <input type="checkbox" id="notif-watched-new_comment" class="settings-toggle"${_notifPrefsWatched.new_comment ? " checked" : ""} />
                </label>
              </div>
              <div class="settings-group">
                <label class="settings-label">
                  <div>
                    <span>Replies to my threads</span>
                    <div class="settings-hint">Someone replied to a thread you started</div>
                  </div>
                  <input type="checkbox" id="notif-watched-new_comment_participated" class="settings-toggle"${_notifPrefsWatched.new_comment_participated ? " checked" : ""} />
                </label>
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-section-title">Events</div>
              <div class="settings-group">
                <label class="settings-label">
                  <span>PR merged</span>
                  <input type="checkbox" id="notif-merged" class="settings-toggle"${_notifyOnMerged ? " checked" : ""} />
                </label>
              </div>
              <div class="settings-group">
                <label class="settings-label">
                  <span>PR closed</span>
                  <input type="checkbox" id="notif-closed" class="settings-toggle"${_notifyOnClosed ? " checked" : ""} />
                </label>
              </div>
            </div>
          </div>
        `;

        // Wire up notification sound toggle
        const soundEl = document.getElementById("notif-sound") as HTMLInputElement | null;
        const volumeRow = document.getElementById("notif-volume-row");
        if (soundEl) {
          soundEl.addEventListener("change", () => {
            _notificationSound = soundEl.checked;
            volumeRow?.classList.toggle("disabled", !soundEl.checked);
            autoSaveSettings();
          });
        }

        // Wire up volume slider
        const volumeEl = document.getElementById("notif-volume") as HTMLInputElement | null;
        if (volumeEl) {
          volumeEl.addEventListener("input", () => {
            _notificationVolume = parseInt(volumeEl.value) / 100;
          });
          volumeEl.addEventListener("change", () => {
            _notificationVolume = parseInt(volumeEl.value) / 100;
            autoSaveSettings();
          });
        }

        // Wire up duration select
        const durationEl = document.getElementById("notif-duration") as HTMLSelectElement | null;
        if (durationEl) {
          durationEl.addEventListener("change", () => {
            const parsed = parseInt(durationEl.value, 10);
            if (!Number.isNaN(parsed)) {
              _notificationDurationSecs = parsed;
              autoSaveSettings();
            }
          });
        }

        // Wire up volume preview button
        const previewBtn = document.getElementById("notif-volume-preview");
        if (previewBtn) {
          previewBtn.addEventListener("click", async () => {
            await autoSaveSettings();
            await invoke("play_sound");
          });
        }

        // Wire up notification mode segmented control
        const setNotifMode = (native: boolean) => {
          _useNativeNotifications = native;
          const pronto = document.getElementById("notif-mode-pronto");
          const nativeBtn = document.getElementById("notif-mode-native");
          pronto?.classList.toggle("active", !native);
          pronto?.setAttribute("aria-checked", String(!native));
          nativeBtn?.classList.toggle("active", native);
          nativeBtn?.setAttribute("aria-checked", String(native));
          autoSaveSettings();
        };
        document.getElementById("notif-mode-pronto")?.addEventListener("click", () => setNotifMode(false));
        document.getElementById("notif-mode-native")?.addEventListener("click", () => setNotifMode(true));

        // Wire up owned/watched checkboxes
        type NotifKey = keyof NotificationPreferences;
        const notifMap: Array<{ id: string; key: NotifKey; state: NotificationPreferences }> = [
          { id: "notif-owned-changes_requested",  key: "changes_requested", state: _notifPrefsOwned },
          { id: "notif-owned-approved",           key: "approved",          state: _notifPrefsOwned },
          { id: "notif-owned-checks_failed",        key: "checks_failed",       state: _notifPrefsOwned },
          { id: "notif-owned-checks_recovered",   key: "checks_recovered",    state: _notifPrefsOwned },
          { id: "notif-owned-kicked_from_queue",  key: "kicked_from_queue",   state: _notifPrefsOwned },
          { id: "notif-owned-new_comment",        key: "new_comment",         state: _notifPrefsOwned },
          { id: "notif-watched-review_required", key: "review_required",   state: _notifPrefsWatched },
          { id: "notif-watched-changes_requested", key: "changes_requested", state: _notifPrefsWatched },
          { id: "notif-watched-approved",        key: "approved",          state: _notifPrefsWatched },
          { id: "notif-watched-new_comment",     key: "new_comment",       state: _notifPrefsWatched },
          { id: "notif-watched-new_comment_participated", key: "new_comment_participated", state: _notifPrefsWatched },
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
              <div class="kb-row">
                <span class="kb-label">Watch selected PR</span>
                <button class="kb-key global-kb-key" data-action="global_watch">${freshSettings.global_watch_shortcut || "Super+Ctrl+L"}</button>
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
                <span class="kb-label">Tab: Watched</span>
                <button class="kb-key" data-action="tab_watched">${formatKeybinding(keybindings.tab_watched)}</button>
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

      case "updates":
        contentArea.innerHTML = `
          <div class="settings-section">
            <div class="settings-section-title">Homebrew Updates</div>
            <div class="settings-group">
              <label class="settings-label">
                <div>
                  <span>Check for Pronto updates</span>
                  <div class="settings-hint">Check Homebrew Cask for newer versions of Pronto</div>
                </div>
                <input type="checkbox" id="setting-brew-enabled" class="settings-toggle"${_brewCheckEnabled ? " checked" : ""} />
              </label>
            </div>
            <div class="settings-group" id="brew-interval-group"${_brewCheckEnabled ? "" : ' style="display:none"'}>
              <label class="settings-label">Check interval</label>
              <select id="setting-brew-interval" class="settings-select">
                <option value="3600"${_brewCheckIntervalSecs === 3600 ? " selected" : ""}>1 hour</option>
                <option value="14400"${_brewCheckIntervalSecs === 14400 ? " selected" : ""}>4 hours</option>
                <option value="43200"${_brewCheckIntervalSecs === 43200 ? " selected" : ""}>12 hours</option>
                <option value="86400"${_brewCheckIntervalSecs === 86400 ? " selected" : ""}>24 hours</option>
              </select>
            </div>
            <div class="settings-group" style="margin-top: 12px;">
              <label class="settings-label">
                <div>
                  <span>Check now</span>
                  <div class="settings-hint" id="brew-check-result">Manually check for a new version</div>
                </div>
                <button id="btn-check-brew" class="settings-action-btn">Check</button>
              </label>
            </div>
            <div class="settings-group" id="brew-note" style="margin-top: 4px; padding: 8px; background: rgba(107, 114, 128, 0.1); border-radius: 4px; font-size: 12px; color: #888;">
              <div>Requires Homebrew installation. Updates appear in the footer.</div>
            </div>
          </div>
        `;
        setupEventListeners();
        document.getElementById("setting-brew-enabled")!.addEventListener("change", (e) => {
          const checked = (e.target as HTMLInputElement).checked;
          _brewCheckEnabled = checked;
          document.getElementById("brew-interval-group")!.style.display = checked ? "" : "none";
          autoSaveSettings();
        });
        document.getElementById("setting-brew-interval")!.addEventListener("change", (e) => {
          const value = parseInt((e.target as HTMLSelectElement).value);
          _brewCheckIntervalSecs = value;
          autoSaveSettings();
        });
        document.getElementById("btn-check-brew")!.addEventListener("click", async () => {
          const btn = document.getElementById("btn-check-brew") as HTMLButtonElement;
          const result = document.getElementById("brew-check-result")!;

          if (btn.dataset.action === "install") {
            btn.disabled = true;
            btn.textContent = "Installing…";
            invoke("update_brew").catch(() => {
              btn.disabled = false;
              btn.textContent = "Install";
            });
            return;
          }

          btn.disabled = true;
          btn.textContent = "Checking…";
          result.textContent = "Checking for updates…";
          try {
            const status = await invoke<HomebrewStatus>("check_brew_now");
            if (!status.available) {
              result.textContent = "Homebrew not found";
              btn.textContent = "Check";
            } else if (status.update_available) {
              result.textContent = `v${status.latest_version} is available (installed: v${status.installed_version})`;
              btn.textContent = "Install";
              btn.dataset.action = "install";
            } else {
              result.textContent = "Up to date";
              btn.textContent = "Check";
            }
          } catch {
            result.textContent = "Check failed — is Homebrew installed?";
            btn.textContent = "Check";
          }
          btn.disabled = false;
        });
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
        <div class="settings-section-title">Watched users</div>
        <div class="settings-group">
          <label class="settings-label"><span>Add GitHub username</span></label>
          <div style="display: flex; gap: 6px;">
            <input type="text" id="watch-user-input" class="settings-input" placeholder="e.g. octocat" autocapitalize="off" autocorrect="off" spellcheck="false" />
            <button id="watch-user-add" class="login-btn" style="width:auto; padding: 8px 14px;">Add</button>
          </div>
        </div>
        <div class="hidden-prs-list" id="watch-users-list">
          ${
            freshSettings.watched_users && freshSettings.watched_users.length > 0
              ? freshSettings.watched_users
                  .map(
                    (u: string) => `
                <div class="hidden-pr-row" data-user="${u}">
                  <span class="hidden-pr-title">${u}</span>
                  <button class="hidden-pr-remove watch-user-remove" data-user="${u}" title="Remove user" aria-label="Remove user">✕</button>
                </div>`
                  )
                  .join("")
              : '<div class="hidden-prs-empty">No watched users</div>'
          }
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Watched PRs</div>
        <div class="settings-group">
          <label class="settings-label">
            <span>Auto-watch PRs you comment on</span>
            <input type="checkbox" id="setting-auto-watch-commented" class="settings-toggle"${_autoWatchCommentedPrs ? " checked" : ""} />
          </label>
          <div class="settings-hint">Adds open PRs you've commented on (and didn't author) so people don't wait for your re-review.</div>
        </div>
        <div class="settings-group">
          <label class="settings-label"><span>Add PR URL</span></label>
          <div style="display: flex; gap: 6px;">
            <input type="text" id="watch-pr-input" class="settings-input" placeholder="e.g. https://github.com/owner/repo/pull/123" autocapitalize="off" autocorrect="off" spellcheck="false" />
            <button id="watch-pr-add" class="login-btn" style="width:auto; padding: 8px 14px;">Add</button>
          </div>
        </div>
        <div class="hidden-prs-list" id="watch-prs-list">
          ${
            freshSettings.watched_prs && freshSettings.watched_prs.length > 0
              ? freshSettings.watched_prs
                  .map(
                    (url: string) => {
                      // Extract owner/repo/pr# from URL for shorter display
                      const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
                      const shortDisplay = match ? `${match[1]}/${match[2]} #${match[3]}` : url;
                      return `
                <div class="hidden-pr-row" data-pr-url="${url.replace(/"/g, "&quot;")}">
                  <span class="hidden-pr-title" title="${url}">${shortDisplay}</span>
                  <button class="hidden-pr-remove watch-pr-remove" data-pr-url="${url.replace(/"/g, "&quot;")}" title="Remove PR" aria-label="Remove PR">✕</button>
                </div>`;
                    }
                  )
                  .join("")
              : '<div class="hidden-prs-empty">No watched PRs</div>'
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

    // Unhide PR buttons (hidden PRs only - not watch-pr-remove)
    contentArea.querySelectorAll<HTMLElement>(".hidden-pr-remove:not(.watch-pr-remove)[data-pr-url]").forEach((btn) => {
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

    const autoWatchToggle = contentArea.querySelector(
      "#setting-auto-watch-commented"
    ) as HTMLInputElement | null;
    autoWatchToggle?.addEventListener("change", (e) => {
      _autoWatchCommentedPrs = (e.target as HTMLInputElement).checked;
      autoSaveSettings();
    });

    // Watched PRs list
    const watchPrList = contentArea.querySelector("#watch-prs-list") as HTMLElement;
    const watchPrInput = contentArea.querySelector("#watch-pr-input") as HTMLInputElement;
    const watchPrAddBtn = contentArea.querySelector("#watch-pr-add") as HTMLButtonElement;

    const refreshWatchPrEmptyState = () => {
      if (!watchPrList.querySelector(".hidden-pr-row")) {
        watchPrList.innerHTML = '<div class="hidden-prs-empty">No watched PRs</div>';
      }
    };

    const addWatchPrRemoveListener = (btn: Element) => {
      btn.addEventListener("click", () => {
        const url = btn.getAttribute("data-pr-url")!;
        watchedPrs.delete(url);
        btn.closest(".hidden-pr-row")?.remove();
        refreshWatchPrEmptyState();
        autoSaveSettings();
      });
    };

    watchPrInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") watchPrAddBtn.click();
    });

    watchPrAddBtn.addEventListener("click", () => {
      const url = watchPrInput.value.trim();
      if (!url) return;
      // Normalize: handle full URLs or short forms
      const normalizedUrl = url.startsWith("http") ? url : `https://github.com/${url}`;
      if (watchedPrs.has(normalizedUrl)) {
        watchPrInput.value = "";
        return;
      }
      watchedPrs.add(normalizedUrl);
      watchPrList.querySelector(".hidden-prs-empty")?.remove();
      const row = document.createElement("div");
      row.className = "hidden-pr-row";
      row.dataset.prUrl = normalizedUrl;
      // Extract owner/repo/pr# from URL for shorter display
      const match = normalizedUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
      const shortDisplay = match ? `${match[1]}/${match[2]} #${match[3]}` : normalizedUrl;
      row.innerHTML = `
        <span class="hidden-pr-title" title="${normalizedUrl}">${shortDisplay}</span>
        <button class="hidden-pr-remove watch-pr-remove" data-pr-url="${normalizedUrl.replace(/"/g, "&quot;")}" title="Remove PR" aria-label="Remove PR">✕</button>
      `;
      watchPrList.appendChild(row);
      const newBtn = row.querySelector(".watch-pr-remove")!;
      addWatchPrRemoveListener(newBtn);
      watchPrInput.value = "";
      autoSaveSettings();
    });

    watchPrList.querySelectorAll(".watch-pr-remove").forEach(addWatchPrRemoveListener);

    // Watched users list
    const watchList = contentArea.querySelector("#watch-users-list") as HTMLElement;
    const watchInput = contentArea.querySelector("#watch-user-input") as HTMLInputElement;
    const watchAddBtn = contentArea.querySelector("#watch-user-add") as HTMLButtonElement;

    const refreshWatchEmptyState = () => {
      if (!watchList.querySelector(".hidden-pr-row")) {
        watchList.innerHTML = '<div class="hidden-prs-empty">No watched users</div>';
      }
    };

    const addWatchRemoveListener = (btn: Element) => {
      btn.addEventListener("click", () => {
        const user = btn.getAttribute("data-user")!;
        setWatchedUsers(watchedUsers.filter((u) => u !== user));
        btn.closest(".hidden-pr-row")?.remove();
        refreshWatchEmptyState();
        if (activeWatchFilter === user) setActiveWatchFilter("all");
        autoSaveSettings();
      });
    };

    watchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") watchAddBtn.click();
    });

    watchAddBtn.addEventListener("click", () => {
      const raw = watchInput.value.trim();
      if (!raw) return;
      const user = raw.replace(/^@/, "");
      if (watchedUsers.includes(user)) {
        watchInput.value = "";
        return;
      }
      watchedUsers.push(user);
      watchList.querySelector(".hidden-prs-empty")?.remove();
      const row = document.createElement("div");
      row.className = "hidden-pr-row";
      row.dataset.user = user;
      row.innerHTML = `
        <span class="hidden-pr-title">${user}</span>
        <button class="hidden-pr-remove watch-user-remove" data-user="${user}" title="Remove user" aria-label="Remove user">✕</button>
      `;
      watchList.appendChild(row);
      const newBtn = row.querySelector(".watch-user-remove")!;
      addWatchRemoveListener(newBtn);
      watchInput.value = "";
      autoSaveSettings();
    });

    watchList.querySelectorAll(".watch-user-remove").forEach(addWatchRemoveListener);
  }

  // Tab switching
  const tabButtons = [...content.querySelectorAll<HTMLElement>(".settings-tab")];
  tabButtons.forEach((btn, index) => {
    btn.addEventListener("click", async () => {
      tabButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      setSettingsNavIndex(index);
      setSettingsGroupIndex(-1);
      const tabName = btn.getAttribute("data-tab")!;
      await renderTab(tabName);
    });
  });

  // Render initial tab
  setSettingsNavIndex(0);
  await renderTab("general");
}
