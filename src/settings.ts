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
} from "./state";

// Injected callback: called when settings view is closed (wired in main.ts)
let _onSettingsClosed: () => void = () => {};

export function initSettings(onClosed: () => void) {
  _onSettingsClosed = onClosed;
}

// ── Hide settings ─────────────────────────────────────────────────────────────

export function hideSettings() {
  _onSettingsClosed();
}

// ── Auto-save ─────────────────────────────────────────────────────────────────

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
  };

  setGroupByRepository(updated.group_by_repository);
  await invoke("update_settings", { settings: updated });
}

// ── Show settings ─────────────────────────────────────────────────────────────

export async function showSettings() {
  const content = document.getElementById("content")!;
  const settings = await invoke<Settings>("get_settings");

  content.innerHTML = `
    <div class="settings-view">
      <div class="settings-title">Settings</div>
      <input type="text" id="settings-search" class="settings-search" placeholder="Search settings…" autocomplete="off" spellcheck="false" autocapitalize="off" autocorrect="off" />

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
    </div>
  `;

  // Toggle merged window group visibility
  document.getElementById("setting-merged")!.addEventListener("change", (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    document.getElementById("merged-window-group")!.style.display = checked ? "" : "none";
  });

  // Toggle workflow config group visibility
  document.getElementById("setting-workflow-enabled")!.addEventListener("change", (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    document.getElementById("workflow-config-group")!.style.display = checked ? "" : "none";
  });

  // Unhide PR buttons
  content.querySelectorAll<HTMLElement>(".hidden-pr-remove[data-pr-url]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.getAttribute("data-pr-url")!;
      hiddenPrs.delete(url);
      btn.closest(".hidden-pr-row")?.remove();
      const list = content.querySelector(".hidden-prs-list");
      if (list && list.querySelectorAll(".hidden-pr-row").length === 0) {
        list.innerHTML = '<div class="hidden-prs-empty">No hidden PRs</div>';
      }
      autoSaveSettings();
    });
  });

  // Followed users list
  const followList = document.getElementById("follow-users-list")!;
  const followInput = document.getElementById("follow-user-input") as HTMLInputElement;
  const followAddBtn = document.getElementById("follow-user-add") as HTMLButtonElement;

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

  // Auto-save on any form input change
  content.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("change", autoSaveSettings);
  });

  // Settings search filter
  const settingsSearchInput = document.getElementById("settings-search") as HTMLInputElement;
  settingsSearchInput.addEventListener("input", () => {
    const q = settingsSearchInput.value.toLowerCase().trim();
    content.querySelectorAll<HTMLElement>(".settings-section").forEach((section) => {
      const title = section.querySelector(".settings-section-title")?.textContent?.toLowerCase() || "";
      const groups = section.querySelectorAll<HTMLElement>(".settings-group, #workflow-config-group > .settings-group");
      const sectionMatch = !q || title.includes(q);
      let anyGroupVisible = false;

      groups.forEach((group) => {
        const label = group.textContent?.toLowerCase() || "";
        const visible = sectionMatch || label.includes(q);
        group.style.display = visible ? "" : "none";
        if (visible) anyGroupVisible = true;
      });

      const hiddenList = section.querySelector<HTMLElement>(".hidden-prs-list");
      if (hiddenList) {
        const listText = hiddenList.textContent?.toLowerCase() || "";
        if (!q || title.includes(q) || listText.includes(q)) {
          hiddenList.style.display = "";
          anyGroupVisible = true;
        } else {
          hiddenList.style.display = "none";
        }
      }

      section.style.display = anyGroupVisible || sectionMatch ? "" : "none";
    });
  });
}
