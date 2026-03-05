import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { FetchResult, WorkflowStatus, TabName, Settings, NotifyData } from "./types";
import {
  currentAttentionUrls,
  setCurrentAttentionUrls,
  setCurrentResult,
  clearPendingUnhide,
  kbDismissTimer,
  setKbDismissTimer,
  focusIndex,
  setFocusIndex,
  activeTab,
  workflowHasAttention,
  setWorkflowHasAttention,
  lastWorkflowConclusion,
  setLastWorkflowConclusion,
  currentResult,
  keybindings,
  setKeybindings,
  showRecentlyMerged,
  setShowRecentlyMerged,
  showClosed,
  setShowClosed,
} from "./state";
import { loadUserPrefs, initPrefs } from "./prefs";
import { renderActiveTab, setActiveTab, updateTabBadges, hideCurrentFocusPr, initTabs } from "./tabs";
import { showSettings, hideSettings, initSettings, loadNotifPrefsFromSettings } from "./settings";
import { showLogin, initAuth } from "./auth";

// ── Polling indicators ────────────────────────────────────────────────────────

let lastCheckedAt: Date | null = null;
let pollIntervalSecs = 60;

// ── PR loading ────────────────────────────────────────────────────────────────

export async function loadPrs() {
  const content = document.getElementById("content")!;
  try {
    const result = await invoke<FetchResult>("fetch_all_prs");
    renderPrView(result);
  } catch (e: unknown) {
    if (typeof e === "string" && e.includes("not_authenticated")) {
      showLogin();
    } else {
      content.innerHTML = `<div class="empty">Failed to load PRs</div>`;
      console.error(e);
    }
  }
}

function renderPrView(result: FetchResult) {
  document.getElementById("signout-btn")!.style.display = "";
  document.getElementById("main-nav")!.style.display = "";
  setCurrentAttentionUrls(result.attention_urls);
  setCurrentResult(result);
  clearPendingUnhide();
  updateWorkflowIndicator(result.workflow_status);
  renderActiveTab();
  lastCheckedAt = new Date();
  updatePollStatus();
}

// ── Workflow indicator ────────────────────────────────────────────────────────

function formatWorkflowStatus(status: string): string {
  return status
    .split("_")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function updateWorkflowIndicator(status: WorkflowStatus | null) {
  const indicator = document.getElementById("workflow-indicator")!;
  if (!status) {
    indicator.style.display = "none";
    return;
  }

  const cls =
    status.conclusion === "success" ? "wf-success"
    : status.conclusion === "failure" ? "wf-failure"
    : "wf-other";

  const changed = lastWorkflowConclusion !== null && lastWorkflowConclusion !== status.conclusion;
  if (changed) setWorkflowHasAttention(true);
  setLastWorkflowConclusion(status.conclusion);

  const attentionCls = workflowHasAttention ? " wf-attention" : "";
  indicator.className = `workflow-indicator ${cls}${attentionCls}`;
  const prettyStatus = formatWorkflowStatus(status.status);
  indicator.innerHTML = `<span class="wf-dot"></span><span class="wf-label">${prettyStatus}</span>`;
  indicator.title = `${status.repo} — ${status.workflow_name}\n${prettyStatus}\n${new Date(status.updated_at).toLocaleString()}`;
  indicator.style.display = "";
}

// ── Polling status indicators ─────────────────────────────────────────────────

function updatePollStatus() {
  const el = document.getElementById("poll-status");
  if (!el || !lastCheckedAt) return;
  const elapsedSecs = Math.floor((Date.now() - lastCheckedAt.getTime()) / 1000);
  const remaining = pollIntervalSecs - elapsedSecs;
  if (remaining > 0) {
    el.textContent = `Polling in ${remaining}s`;
  } else {
    const mins = Math.floor(Math.abs(remaining) / 60);
    el.textContent = mins > 0 ? `Last checked ${mins}m ago` : `Last checked just now`;
  }
}

// ── Keyboard focus ────────────────────────────────────────────────────────────

function getFocusables(): Element[] {
  const content = document.getElementById("content")!;
  return [...content.querySelectorAll("summary.accordion-header, .pr-card")];
}

function clearKbDismiss() {
  if (kbDismissTimer) {
    clearTimeout(kbDismissTimer);
    setKbDismissTimer(null);
  }
}

function setFocus(index: number) {
  const items = getFocusables();
  if (items.length === 0) return;

  clearKbDismiss();
  document.querySelector(".kb-focus")?.classList.remove("kb-focus");

  const newIndex = Math.max(0, Math.min(index, items.length - 1));
  setFocusIndex(newIndex);
  const el = items[newIndex];
  el.classList.add("kb-focus");
  el.scrollIntoView({ block: "nearest" });

  if (el.classList.contains("pr-card")) {
    const url = el.getAttribute("data-url");
    // Clear element highlights on keyboard focus
    if (url && currentResult?.element_changes) {
      delete currentResult.element_changes[url];
    }
    el.querySelectorAll<HTMLElement>(".status-detail.highlight-attention")
      .forEach((e) => e.classList.remove("highlight-attention"));
    el.querySelectorAll<HTMLElement>(".highlight-changed")
      .forEach((e) => e.classList.remove("highlight-changed"));

    if (el.classList.contains("attention")) {
      setKbDismissTimer(
        setTimeout(() => {
          el.classList.remove("attention");
          if (url) {
            setCurrentAttentionUrls(currentAttentionUrls.filter((u) => u !== url));
            invoke("dismiss_pr", { url });
          }
          updateTabBadges();
        }, 300)
      );
    }
  }
}

// ── Confirmation click pattern ────────────────────────────────────────────────

function addConfirmedClickHandler(btn: HTMLElement, action: () => Promise<void>) {
  let confirming = false;
  let cancelTimeout: ReturnType<typeof setTimeout> | null = null;
  const labelEl = btn.querySelector<HTMLElement>(".nav-label") ?? btn;
  const originalLabel = labelEl.textContent ?? "";

  const cancelConfirm = () => {
    confirming = false;
    btn.classList.remove("confirming");
    labelEl.textContent = originalLabel;
    if (cancelTimeout) clearTimeout(cancelTimeout);
    cancelTimeout = null;
  };

  btn.addEventListener("click", async () => {
    if (!confirming) {
      confirming = true;
      btn.classList.add("confirming");
      labelEl.textContent = "Sure?";
      cancelTimeout = setTimeout(cancelConfirm, 3000);
    } else {
      cancelConfirm();
      await action();
    }
  });

  document.addEventListener("click", (e) => {
    if (confirming && !btn.contains(e.target as Node)) {
      cancelConfirm();
    }
  });
}

// ── Notification window ───────────────────────────────────────────────────────

async function initNotificationView() {
  const data = await invoke<NotifyData | null>("get_notification_data");
  if (!data) { setTimeout(() => getCurrentWindow().close(), 100); return; }

  const isError = data.kind === "error";

  document.body.innerHTML = `
    <div class="notify-popup notify-${data.kind}">
      <div class="notify-content">
        <div class="notify-title">${data.title}</div>
        <div class="notify-message">${data.message}</div>
      </div>
    </div>
  `;

  setTimeout(() => getCurrentWindow().close(), isError ? 7000 : 3000);
}

// ── Follow toast ──────────────────────────────────────────────────────────────

function showFollowToast(prUrl: string, added: boolean) {
  document.getElementById("follow-toast")?.remove();
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  const label = match ? `${match[1]}/${match[2]} #${match[3]}` : prUrl;
  const toast = document.createElement("div");
  toast.id = "follow-toast";
  toast.className = "follow-toast" + (added ? "" : " follow-toast-removed");
  toast.textContent = added ? `Following ${label}` : `Unfollowed ${label}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", async () => {
  if (getCurrentWindow().label === "notify") {
    await initNotificationView();
    return;
  }

  // Wire up inter-module callbacks
  initPrefs(
    () => renderActiveTab(),
    () => loadPrs()
  );
  initTabs(() => showSettings());
  initSettings(async () => {
    const updated = await invoke<Settings>("get_settings");
    pollIntervalSecs = updated.poll_interval_secs;
    setActiveTab("mine");
    loadPrs();
  });
  initAuth(() => loadPrs());

  await loadUserPrefs();

  // Load keybindings and notification prefs from settings
  const settings = await invoke<Settings>("get_settings");
  if (settings?.keybindings) {
    setKeybindings(settings.keybindings);
  }
  loadNotifPrefsFromSettings(settings);

  // Initialize polling indicators
  pollIntervalSecs = settings.poll_interval_secs;
  lastCheckedAt = new Date();
  updatePollStatus();

  // Only update poll status when window is visible
  const window = getCurrentWindow();
  let pollStatusInterval: ReturnType<typeof setInterval> | null = null;

  const startPollStatusUpdates = () => {
    if (!pollStatusInterval) {
      updatePollStatus(); // Update immediately when focused
      pollStatusInterval = setInterval(updatePollStatus, 5000);
    }
  };

  const stopPollStatusUpdates = () => {
    if (pollStatusInterval) {
      clearInterval(pollStatusInterval);
      pollStatusInterval = null;
    }
  };

  window.listen('tauri://focus', () => startPollStatusUpdates());
  window.listen('tauri://blur', () => stopPollStatusUpdates());

  // Start updates if window is currently visible
  if (await window.isFocused()) {
    startPollStatusUpdates();
  }

  // Toggle merged tab visibility based on settings
  const mergedBtn = document.querySelector('[data-tab="merged"]') as HTMLElement | null;
  if (mergedBtn) {
    if (settings?.show_recently_merged) {
      setShowRecentlyMerged(true);
      mergedBtn.style.display = "";
    } else {
      setShowRecentlyMerged(false);
      mergedBtn.style.display = "none";
    }
  }

  // Toggle closed tab visibility based on settings
  const closedBtn = document.querySelector('[data-tab="closed"]') as HTMLElement | null;
  if (closedBtn) {
    if (settings?.show_closed) {
      setShowClosed(true);
      closedBtn.style.display = "";
    } else {
      setShowClosed(false);
      closedBtn.style.display = "none";
    }
  }

  const isAuthed = await invoke<boolean>("check_auth");
  if (isAuthed) {
    loadPrs();
  } else {
    showLogin();
  }

  await listen<{ url: string; added: boolean }>("pr-follow-toggled", async (event) => {
    await loadUserPrefs();
    loadPrs();
    showFollowToast(event.payload.url, event.payload.added);
  });

  await listen<FetchResult>("prs-updated", (event) => {
    if (event.payload) {
      renderPrView(event.payload);
    } else {
      loadPrs();
    }
  });

  // Polling event listeners
  await listen("polling-started", () => {
    document.querySelector<HTMLImageElement>(".panel-logo")?.classList.add("polling");
    document.getElementById("spinner")!.style.display = "";
    document.getElementById("poll-status")!.textContent = "Polling...";
  });

  await listen("polling-complete", () => {
    document.querySelector<HTMLImageElement>(".panel-logo")?.classList.remove("polling");
    document.getElementById("spinner")!.style.display = "none";
    lastCheckedAt = new Date();
    updatePollStatus();
  });

  // Nav tab buttons
  document.querySelectorAll("#main-nav .nav-item[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setActiveTab(btn.getAttribute("data-tab") as TabName);
    });
  });

  // Workflow indicator
  const wfIndicator = document.getElementById("workflow-indicator")!;
  wfIndicator.addEventListener("click", () => {
    if (currentResult?.workflow_status) {
      const { repo, workflow_name } = currentResult.workflow_status;
      const workflowUrl = `https://github.com/${repo}/actions/workflows/${workflow_name}`;
      openUrl(workflowUrl);
      if (workflowHasAttention) {
        setWorkflowHasAttention(false);
        wfIndicator.classList.remove("wf-attention");
        invoke("dismiss_workflow");
      }
    }
  });

  let wfDismissTimer: ReturnType<typeof setTimeout> | null = null;
  wfIndicator.addEventListener("mouseenter", () => {
    if (workflowHasAttention) {
      wfDismissTimer = setTimeout(() => {
        setWorkflowHasAttention(false);
        wfIndicator.classList.remove("wf-attention");
        invoke("dismiss_workflow");
      }, 800);
    }
  });
  wfIndicator.addEventListener("mouseleave", () => {
    if (wfDismissTimer) {
      clearTimeout(wfDismissTimer);
      wfDismissTimer = null;
    }
  });

  // Keyboard navigation
  document.addEventListener("keydown", async (e) => {
    const settingsOpen = activeTab === "settings";

    if (e.key === "Escape") {
      e.preventDefault();
      if (settingsOpen) {
        hideSettings();
      } else {
        getCurrentWindow().hide();
      }
      return;
    }

    if (settingsOpen || !currentResult) return;

    const items = getFocusables();
    const tabKeys = [keybindings.tab_owned, keybindings.tab_followed];
    if (showRecentlyMerged) tabKeys.push(keybindings.tab_merged);
    tabKeys.push("Tab");
    if (!items.length && !tabKeys.includes(e.key)) return;

    // Navigate down
    if (e.key === keybindings.navigate_down || e.key === "ArrowDown") {
      e.preventDefault();
      setFocus(focusIndex + 1);
      return;
    }

    // Navigate up
    if (e.key === keybindings.navigate_up || e.key === "ArrowUp") {
      e.preventDefault();
      setFocus(focusIndex - 1);
      return;
    }

    // Collapse
    if (e.key === keybindings.collapse || e.key === "ArrowLeft") {
      e.preventDefault();
      if (focusIndex < 0) return;
      const el = items[focusIndex];
      const details = el.closest("details");
      if (details && (details as HTMLDetailsElement).open) {
        (details as HTMLDetailsElement).open = false;
        details.dispatchEvent(new Event("toggle"));
      }
      return;
    }

    // Expand
    if (e.key === keybindings.expand || e.key === "ArrowRight") {
      e.preventDefault();
      if (focusIndex < 0) return;
      const el = items[focusIndex];
      const details = el.closest("details");
      if (details && !(details as HTMLDetailsElement).open) {
        (details as HTMLDetailsElement).open = true;
        details.dispatchEvent(new Event("toggle"));
      }
      return;
    }

    // Open PR
    if (e.key === keybindings.open_pr) {
      e.preventDefault();
      if (focusIndex < 0) return;
      const el = items[focusIndex];
      if (el.classList.contains("pr-card")) {
        const url = el.getAttribute("data-url");
        if (url) openUrl(url);
      } else if (el.tagName === "SUMMARY") {
        const details = el.closest("details") as HTMLDetailsElement;
        if (details) {
          details.open = !details.open;
          details.dispatchEvent(new Event("toggle"));
        }
      }
      return;
    }

    // Tab: Owned
    if (e.key === keybindings.tab_owned) {
      e.preventDefault();
      setActiveTab("mine");
      return;
    }

    // Tab: Followed
    if (e.key === keybindings.tab_followed) {
      e.preventDefault();
      setActiveTab("followed");
      return;
    }

    // Tab: Merged
    if (e.key === keybindings.tab_merged && showRecentlyMerged) {
      e.preventDefault();
      setActiveTab("merged");
      return;
    }

    // Tab: Closed
    if (e.key === keybindings.tab_closed && showClosed) {
      e.preventDefault();
      setActiveTab("closed");
      return;
    }

    // Hide PR
    if (e.key === keybindings.hide_pr) {
      e.preventDefault();
      const hidden = await hideCurrentFocusPr(focusIndex);
      if (hidden) loadPrs();
      return;
    }

    // Copy URL
    if (e.key === keybindings.copy_url) {
      e.preventDefault();
      if (focusIndex < 0) return;
      const el = items[focusIndex];
      if (el.classList.contains("pr-card")) {
        const url = el.getAttribute("data-url");
        if (url) {
          navigator.clipboard.writeText(url).then(() => {
            const copyBtn = el.querySelector<HTMLButtonElement>(".copy-btn");
            if (copyBtn) {
              copyBtn.classList.add("copied");
              setTimeout(() => copyBtn.classList.remove("copied"), 1500);
            }
          });
        }
      }
      return;
    }

    // Cycle tabs with Tab key
    if (e.key === "Tab") {
      e.preventDefault();
      const cycle: TabName[] = ["mine", "followed"];
      if (showRecentlyMerged) {
        cycle.push("merged");
      }
      if (showClosed) {
        cycle.push("closed");
      }
      const i = cycle.indexOf(activeTab);
      const next = cycle[(i + (e.shiftKey ? 2 : 1)) % cycle.length];
      setActiveTab(next);
      return;
    }
  });

  // Sign out + quit buttons
  const signoutBtn = document.getElementById("signout-btn");
  if (signoutBtn) {
    addConfirmedClickHandler(signoutBtn, async () => {
      await invoke("logout");
      showLogin();
    });
  }

  const quitBtn = document.getElementById("quit-btn");
  if (quitBtn) {
    addConfirmedClickHandler(quitBtn, async () => {
      const { exit } = await import("@tauri-apps/plugin-process");
      await exit(0);
    });
  }
});
