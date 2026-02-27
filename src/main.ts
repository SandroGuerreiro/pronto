import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { FetchResult, WorkflowStatus } from "./types";
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
} from "./state";
import { loadUserPrefs, initPrefs } from "./prefs";
import { renderActiveTab, setActiveTab, updateTabBadges, hideCurrentFocusPr, initTabs } from "./tabs";
import { showSettings, hideSettings, initSettings } from "./settings";
import { showLogin, initAuth } from "./auth";

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
}

// ── Workflow indicator ────────────────────────────────────────────────────────

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
  indicator.innerHTML = `<span class="wf-dot"></span><span class="wf-label">${status.status}</span>`;
  indicator.title = `${status.repo} — ${status.workflow_name}\n${status.status}\n${new Date(status.updated_at).toLocaleString()}`;
  indicator.style.display = "";
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

  if (el.classList.contains("pr-card") && el.classList.contains("attention")) {
    setKbDismissTimer(
      setTimeout(() => {
        el.classList.remove("attention");
        const url = el.getAttribute("data-url");
        if (url) {
          setCurrentAttentionUrls(currentAttentionUrls.filter((u) => u !== url));
          invoke("dismiss_pr", { url });
        }
        updateTabBadges();
      }, 800)
    );
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

// ── Boot ──────────────────────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", async () => {
  // Wire up inter-module callbacks
  initPrefs(
    () => renderActiveTab(),
    () => loadPrs()
  );
  initTabs(() => showSettings());
  initSettings(() => {
    setActiveTab("mine");
    loadPrs();
  });
  initAuth(() => loadPrs());

  await loadUserPrefs();

  const isAuthed = await invoke<boolean>("check_auth");
  if (isAuthed) {
    loadPrs();
  } else {
    showLogin();
  }

  listen("prs-updated", () => loadPrs());

  // Nav tab buttons
  document.querySelectorAll("#main-nav .nav-item[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setActiveTab(btn.getAttribute("data-tab") as "mine" | "followed" | "merged" | "settings");
    });
  });

  // Workflow indicator
  const wfIndicator = document.getElementById("workflow-indicator")!;
  wfIndicator.addEventListener("click", () => {
    if (currentResult?.workflow_status) {
      openUrl(currentResult.workflow_status.html_url);
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
    if (!items.length && !["1", "2", "3", "Tab"].includes(e.key)) return;

    switch (e.key) {
      case "j":
      case "ArrowDown":
        e.preventDefault();
        setFocus(focusIndex + 1);
        break;
      case "k":
      case "ArrowUp":
        e.preventDefault();
        setFocus(focusIndex - 1);
        break;
      case "h":
      case "ArrowLeft": {
        e.preventDefault();
        if (focusIndex < 0) break;
        const el = items[focusIndex];
        const details = el.closest("details");
        if (details && (details as HTMLDetailsElement).open) {
          (details as HTMLDetailsElement).open = false;
          details.dispatchEvent(new Event("toggle"));
        }
        break;
      }
      case "l":
      case "ArrowRight": {
        e.preventDefault();
        if (focusIndex < 0) break;
        const el = items[focusIndex];
        const details = el.closest("details");
        if (details && !(details as HTMLDetailsElement).open) {
          (details as HTMLDetailsElement).open = true;
          details.dispatchEvent(new Event("toggle"));
        }
        break;
      }
      case "Enter": {
        e.preventDefault();
        if (focusIndex < 0) break;
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
        break;
      }
      case "1":
        e.preventDefault();
        setActiveTab("mine");
        break;
      case "2":
        e.preventDefault();
        setActiveTab("followed");
        break;
      case "3":
        e.preventDefault();
        setActiveTab("merged");
        break;
      case "i": {
        e.preventDefault();
        const hidden = await hideCurrentFocusPr(focusIndex);
        if (hidden) loadPrs();
        break;
      }
      case "c": {
        e.preventDefault();
        if (focusIndex < 0) break;
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
        break;
      }
      case "Tab": {
        e.preventDefault();
        const cycle = ["mine", "followed", "merged"] as const;
        const i = cycle.indexOf(activeTab as "mine" | "followed" | "merged");
        const next = cycle[(i + (e.shiftKey ? 2 : 1)) % 3];
        setActiveTab(next);
        break;
      }
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
