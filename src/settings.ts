import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "./types";
import {
  favoriteOrgs,
  favoriteRepos,
  collapsedAccordions,
  hiddenOrgs,
  hiddenRepos,
  hiddenPrs,
  followedUsers,
  setGroupByRepository,
  setFollowedUsers,
  activeFollowFilter,
  setActiveFollowFilter,
  keybindings,
  setKeybindings,
} from "./state";

// Injected callback: called when settings view is closed (wired in main.ts)
let _onSettingsClosed: () => void = () => {};

export function initSettings(onClosed: () => void) {
  _onSettingsClosed = onClosed;
}

export function hideSettings() {
  _onSettingsClosed();
}

// ── Auto-save ─────────────────────────────────────────────────────────────

export async function autoSaveSettings() {
  const pollEl = document.getElementById("setting-poll") as HTMLSelectElement | null;
  const notifEl = document.getElementById("setting-notifications") as HTMLInputElement | null;
  const mergedEl = document.getElementById("setting-merged") as HTMLInputElement | null;
  const mergedHoursEl = document.getElementById("setting-merged-hours") as HTMLSelectElement | null;
  const groupRepoEl = document.getElementById("setting-group-repo") as HTMLInputElement | null;
  const wfEnabledEl = document.getElementById("setting-workflow-enabled") as HTMLInputElement | null;
  const wfOrgEl = document.getElementById("setting-workflow-org") as HTMLInputElement | null;
  const wfRepoEl = document.getElementById("setting-workflow-repo") as HTMLInputElement | null;
  const wfNameEl = document.getElementById("setting-workflow-name") as HTMLInputElement | null;

  // Collect keybindings from state
  const kbToSave = { ...keybindings };

  const updated: Settings = {
    poll_interval_secs: pollEl ? parseInt(pollEl.value) : 300,
    notifications_enabled: notifEl?.checked ?? true,
    show_recently_merged: mergedEl?.checked ?? false,
    merged_window_hours: mergedHoursEl ? parseInt(mergedHoursEl.value) : 24,
    favorite_orgs: [...favoriteOrgs],
    favorite_repos: [...favoriteRepos],
    collapsed_accordions: [...collapsedAccordions],
    hidden_orgs: [...hiddenOrgs],
    hidden_repos: [...hiddenRepos],
    hidden_prs: [...hiddenPrs.entries()].map(([url, title]) => ({ url, title })),
    followed_users: followedUsers,
    group_by_repository: groupRepoEl?.checked ?? true,
    workflow_monitor_enabled: wfEnabledEl?.checked ?? false,
    workflow_org: wfOrgEl?.value.trim() ?? "",
    workflow_repo: wfRepoEl?.value.trim() ?? "",
    workflow_name: wfNameEl?.value.trim() ?? "",
    keybindings: kbToSave,
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

// ── Show settings ─────────────────────────────────────────────────────────

export async function showSettings() {
  const content = document.getElementById("content")!;
  const settings = await invoke<Settings>("get_settings");

  content.innerHTML = `
    <div class="settings-view">
      <div class="settings-sidebar">
        <button class="settings-tab active" data-tab="general">⚙<span>General</span></button>
        <button class="settings-tab" data-tab="display">▤<span>Display</span></button>
        <button class="settings-tab" data-tab="workflow">⚡<span>Workflow</span></button>
        <button class="settings-tab" data-tab="shortcuts">⌨<span>Keys</span></button>
        <button class="settings-tab" data-tab="users">👥<span>Users</span></button>
      </div>
      <div class="settings-content">
        <!-- Tab content rendered here -->
      </div>
    </div>
  `;

  const contentArea = document.querySelector(".settings-content") as HTMLElement;

  // Render tab function
  function renderTab(tabName: string) {
    switch (tabName) {
      case "general":
        contentArea.innerHTML = `
          <div class="settings-section">
            <div class="settings-section-title">General</div>
            <div class="settings-group">
              <label class="settings-label">Polling interval</label>
              <select id="setting-poll" class="settings-select">
                <option value="60"${settings.poll_interval_secs === 60 ? " selected" : ""}>1 minute</option>
                <option value="120"${settings.poll_interval_secs === 120 ? " selected" : ""}>2 minutes</option>
                <option value="300"${settings.poll_interval_secs === 300 ? " selected" : ""}>5 minutes</option>
                <option value="600"${settings.poll_interval_secs === 600 ? " selected" : ""}>10 minutes</option>
              </select>
            </div>
            <div class="settings-group">
              <label class="settings-label">
                <span>Notifications</span>
                <input type="checkbox" id="setting-notifications" class="settings-toggle"${settings.notifications_enabled ? " checked" : ""} />
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
                <input type="checkbox" id="setting-group-repo" class="settings-toggle"${settings.group_by_repository !== false ? " checked" : ""} />
              </label>
            </div>
            <div class="settings-group">
              <label class="settings-label">
                <span>Show recently merged</span>
                <input type="checkbox" id="setting-merged" class="settings-toggle"${settings.show_recently_merged ? " checked" : ""} />
              </label>
            </div>
            <div class="settings-group" id="merged-window-group"${settings.show_recently_merged ? "" : ' style="display:none"'}>
              <label class="settings-label">Merged time window</label>
              <select id="setting-merged-hours" class="settings-select">
                <option value="12"${settings.merged_window_hours === 12 ? " selected" : ""}>12 hours</option>
                <option value="24"${settings.merged_window_hours === 24 ? " selected" : ""}>24 hours</option>
                <option value="48"${settings.merged_window_hours === 48 ? " selected" : ""}>48 hours</option>
              </select>
            </div>
          </div>
        `;
        setupEventListeners();
        document.getElementById("setting-merged")!.addEventListener("change", (e) => {
          const checked = (e.target as HTMLInputElement).checked;
          document.getElementById("merged-window-group")!.style.display = checked ? "" : "none";
          autoSaveSettings();
        });
        break;

      case "workflow":
        contentArea.innerHTML = `
          <div class="settings-section">
            <div class="settings-section-title">Workflow</div>
            <div class="settings-group">
              <label class="settings-label">
                <span>Monitor workflow</span>
                <input type="checkbox" id="setting-workflow-enabled" class="settings-toggle"${settings.workflow_monitor_enabled ? " checked" : ""} />
              </label>
            </div>
            <div id="workflow-config-group"${settings.workflow_monitor_enabled ? "" : ' style="display:none"'}>
              <div class="settings-group">
                <label class="settings-label">Organization</label>
                <input type="text" id="setting-workflow-org" class="settings-input" value="${settings.workflow_org || ""}" placeholder="e.g. my-org" autocapitalize="off" autocorrect="off" spellcheck="false" />
              </div>
              <div class="settings-group">
                <label class="settings-label">Repository</label>
                <input type="text" id="setting-workflow-repo" class="settings-input" value="${settings.workflow_repo || ""}" placeholder="e.g. recharge-v2" autocapitalize="off" autocorrect="off" spellcheck="false" />
              </div>
              <div class="settings-group">
                <label class="settings-label">Workflow file</label>
                <input type="text" id="setting-workflow-name" class="settings-input" value="${settings.workflow_name || ""}" placeholder="e.g. deploy.yml" autocapitalize="off" autocorrect="off" spellcheck="false" />
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
            </div>
          </div>
        `;
        setupKeybindingListeners();
        break;

      case "users":
        renderUsersTab();
        break;
    }
  }

  function setupEventListeners() {
    contentArea.querySelectorAll("input, select").forEach((input) => {
      input.addEventListener("change", autoSaveSettings);
    });
  }

  function setupKeybindingListeners() {
    contentArea.querySelectorAll(".kb-key").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action")!;
        startKeyCapture(btn as HTMLElement, (key: string) => {
          setKeybindings({ [action]: key });
          (btn as HTMLElement).textContent = formatKeybinding(key);
          autoSaveSettings();
        });
      });
    });
  }

  function renderUsersTab() {
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
            settings.followed_users && settings.followed_users.length > 0
              ? settings.followed_users
                  .map(
                    (u) => `
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

    // Unhide PR buttons
    contentArea.querySelectorAll<HTMLElement>(".hidden-pr-remove[data-pr-url]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const url = btn.getAttribute("data-pr-url")!;
        hiddenPrs.delete(url);
        btn.closest(".hidden-pr-row")?.remove();
        const list = contentArea.querySelector(".hidden-prs-list");
        if (list && list.querySelectorAll(".hidden-pr-row").length === 0) {
          list.innerHTML = '<div class="hidden-prs-empty">No hidden PRs</div>';
        }
        autoSaveSettings();
      });
    });

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
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tabName = btn.getAttribute("data-tab")!;
      renderTab(tabName);
    });
  });

  // Render initial tab
  renderTab("general");
}
