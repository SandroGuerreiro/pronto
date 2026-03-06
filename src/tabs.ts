import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { TabName } from "./types";
import {
  currentResult,
  currentAttentionUrls,
  setCurrentAttentionUrls,
  activeTab,
  setActiveTabState,
  activeFollowFilter,
  setActiveFollowFilter,
  setShowAuthorInCards,
  hiddenOrgs,
  hiddenRepos,
  groupByRepository,
  collapsedAccordions,
  hiddenPrs,
  followedUsers,
  followedPrs,
  searchQuery,
  setSearchQuery,
  setFocusIndex,
} from "./state";
import {
  filterPrs,
  renderAccordionContent,
  renderFlatList,
  renderCollapsibleSection,
} from "./renderer";
import { persistPrefs, toggleFavorite, toggleHidden } from "./prefs";

// Injected callback for showSettings (wired in main.ts to avoid circular dep)
let _showSettings: () => void = () => {};
export function initTabs(showSettingsFn: () => void) {
  _showSettings = showSettingsFn;
}

// ── Search bar only (no filters) ──────────────────────────────────────────────

function renderSearchBar(): string {
  return `
    <div class="search-filter-bar">
      <div class="search-input-wrapper">
        <svg class="search-bar-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <circle cx="7" cy="7" r="4.5"/>
          <line x1="10.5" y1="10.5" x2="13.5" y2="13.5"/>
        </svg>
        <input
          type="text"
          id="pr-search-input"
          class="search-input"
          placeholder="Search PRs…"
          value="${searchQuery.replace(/"/g, "&quot;")}"
          autocomplete="off"
          spellcheck="false"
          autocapitalize="off"
          autocorrect="off"
        />
        <button id="search-clear-btn" class="search-clear-btn" style="${searchQuery ? "" : "display:none"}" title="Clear search">✕</button>
      </div>
    </div>
  `;
}

// ── Bind search/filter events ─────────────────────────────────────────────────

function bindSearchEvents(content: HTMLElement) {
  const searchInput = content.querySelector<HTMLInputElement>("#pr-search-input");
  const clearBtn = content.querySelector<HTMLButtonElement>("#search-clear-btn");

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const val = searchInput.value;
      const cursor = searchInput.selectionStart ?? val.length;
      setSearchQuery(val);
      renderActiveTab();
      const newInput = document.getElementById("pr-search-input") as HTMLInputElement | null;
      if (newInput) {
        newInput.focus();
        newInput.setSelectionRange(cursor, cursor);
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      setSearchQuery("");
      renderActiveTab();
      document.getElementById("pr-search-input")?.focus();
    });
  }
}

// ── Tab rendering ─────────────────────────────────────────────────────────────

export function renderActiveTab() {
  if (activeTab === "settings") return; // Don't re-render if settings is open
  if (!currentResult) return;
  setFocusIndex(-1);
  const content = document.getElementById("content")!;
  let html = "";

  if (activeTab === "mine") {
    const prs = currentResult.open;
    const filtered = searchQuery ? filterPrs(prs, searchQuery, "all") : prs;
    const forceExpand = searchQuery !== "";

    html += renderSearchBar();

    if (filtered.length === 0 && !searchQuery) {
      const hasHidden = hiddenOrgs.size > 0 || hiddenRepos.size > 0;
      html += hasHidden
        ? renderAccordionContent(prs)
        : '<div class="empty">No open PRs</div>';
    } else if (filtered.length === 0 && searchQuery) {
      html += `<div class="empty">No PRs match <em>"${searchQuery}"</em></div>`;
    } else {
      const body = groupByRepository
        ? renderAccordionContent(filtered, forceExpand)
        : renderFlatList(filtered);
      html += body || '<div class="empty">No open PRs</div>';
    }

  } else if (activeTab === "followed") {
    if (followedUsers.length === 0 && followedPrs.size === 0) {
      html = '<div class="empty">No followed developers or PRs. Add some in Settings.</div>';
    } else {
      const allOpen = currentResult.followed_open || [];

      html += renderSearchBar();

      // Per-user filter bar (moved below search bar)
      if (followedUsers.length > 1 || followedPrs.size > 0) {
        const attentionByUser: Record<string, number> = {};
        for (const pr of allOpen) {
          if (currentAttentionUrls.includes(pr.url)) {
            const u = pr.author.login;
            attentionByUser[u] = (attentionByUser[u] || 0) + 1;
          }
        }
        const totalAttention = Object.values(attentionByUser).reduce((a, b) => a + b, 0);

        // Show "All" + selected user (or first N users) inline, rest in dropdown
        const inlineCount = 3;
        let visibleUsers = [...followedUsers];

        // If a specific user is selected, move them to the front to ensure visibility
        if (activeFollowFilter !== "all" && followedUsers.includes(activeFollowFilter)) {
          const selectedIndex = visibleUsers.indexOf(activeFollowFilter);
          const selected = visibleUsers.splice(selectedIndex, 1)[0];
          visibleUsers.unshift(selected);
        }

        const inlineUsers = visibleUsers.slice(0, inlineCount);
        const moreUsers = visibleUsers.slice(inlineCount);

        html += `<div class="follow-filter-bar">
          <button class="follow-filter-btn${activeFollowFilter === "all" ? " active" : ""}" data-filter="all">All${totalAttention ? `<span class="tab-badge">${totalAttention}</span>` : ""}</button>
          ${followedPrs.size > 0 ? `<button class="follow-filter-btn${activeFollowFilter === "direct" ? " active" : ""}" data-filter="direct">Direct</button>` : ""}
          ${inlineUsers
            .map((u) => {
              const count = attentionByUser[u] || 0;
              return `<button class="follow-filter-btn${activeFollowFilter === u ? " active" : ""}" data-filter="${u}">@${u}${count ? `<span class="tab-badge">${count}</span>` : ""}</button>`;
            })
            .join("")}
          ${moreUsers.length > 0 ? `
            <div class="follow-filter-dropdown-wrapper">
              <button class="follow-filter-btn follow-filter-more-btn" id="follow-filter-more">+${moreUsers.length}</button>
              <div class="follow-filter-dropdown" id="follow-filter-dropdown">
                ${moreUsers
                  .map((u) => {
                    const count = attentionByUser[u] || 0;
                    return `<button class="follow-filter-dropdown-item${activeFollowFilter === u ? " active" : ""}" data-filter="${u}">@${u}${count ? `<span class="tab-badge">${count}</span>` : ""}</button>`;
                  })
                  .join("")}
              </div>
            </div>
          ` : ""}
        </div>`;
      }

      // Apply filter (all, direct, or specific user)
      let byFilter = allOpen;
      if (activeFollowFilter === "direct") {
        byFilter = allOpen.filter((pr) => followedPrs.has(pr.url));
      } else if (activeFollowFilter !== "all") {
        const filterLower = activeFollowFilter.toLowerCase();
        byFilter = allOpen.filter((pr) => pr.author.login.toLowerCase() === filterLower);
      }

      const filtered = searchQuery ? filterPrs(byFilter, searchQuery, "all") : byFilter;

      setShowAuthorInCards(true);
      if (filtered.length === 0 && searchQuery) {
        html += `<div class="empty">No PRs match <em>"${searchQuery}"</em></div>`;
      } else {
        const body = groupByRepository
          ? renderAccordionContent(filtered, searchQuery !== "")
          : renderFlatList(filtered);
        html += body || '<div class="empty">No PRs</div>';
      }
      setShowAuthorInCards(false);
    }

  } else if (activeTab === "merged") {
    const mine = currentResult.recently_merged || [];
    const following = currentResult.followed_recently_merged || [];
    if (mine.length === 0 && following.length === 0) {
      html = '<div class="empty">No recently merged PRs</div>';
    } else {
      if (mine.length > 0) html += renderCollapsibleSection("section:owned", "Owned", mine);
      if (following.length > 0) {
        setShowAuthorInCards(true);
        html += renderCollapsibleSection("section:following", "Following", following);
        setShowAuthorInCards(false);
      }
    }

  } else if (activeTab === "closed") {
    const mine = currentResult.recently_closed || [];
    const following = currentResult.followed_recently_closed || [];
    if (mine.length === 0 && following.length === 0) {
      html = '<div class="empty">No recently closed PRs</div>';
    } else {
      if (mine.length > 0) html += renderCollapsibleSection("section:owned", "Owned", mine);
      if (following.length > 0) {
        setShowAuthorInCards(true);
        html += renderCollapsibleSection("section:following", "Following", following);
        setShowAuthorInCards(false);
      }
    }
  }

  if (!html) html = '<div class="empty">No PRs</div>';
  content.innerHTML = html;
  bindContentEvents(content);

  // Bind follow filter buttons (all, direct, user filters)
  content.querySelectorAll<HTMLButtonElement>(".follow-filter-btn[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setActiveFollowFilter(btn.getAttribute("data-filter") || "all");
      renderActiveTab();
    });
  });

  // Bind dropdown items
  content.querySelectorAll<HTMLButtonElement>(".follow-filter-dropdown-item").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setActiveFollowFilter(btn.getAttribute("data-filter") || "all");
      renderActiveTab();
    });
  });

  // Toggle dropdown on more button click
  const moreBtn = content.querySelector<HTMLButtonElement>("#follow-filter-more");
  const dropdown = content.querySelector<HTMLElement>("#follow-filter-dropdown");
  if (moreBtn && dropdown) {
    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.toggle("visible");
    });
    // Close dropdown when clicking elsewhere
    document.addEventListener("click", () => {
      dropdown.classList.remove("visible");
    });
  }

  // Bind search/filter events
  if (activeTab === "mine" || activeTab === "followed") {
    bindSearchEvents(content);
  }

  updateTabBadges();
}

// ── Set active tab ────────────────────────────────────────────────────────────

export function setActiveTab(tab: TabName) {
  // Reset search on tab switch
  setSearchQuery("");

  setActiveTabState(tab);
  document.querySelectorAll("#main-nav .nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
  });

  if (tab === "settings") {
    _showSettings();
  } else {
    renderActiveTab();
  }
}

// ── Tab badges ────────────────────────────────────────────────────────────────

export function updateTabBadges() {
  if (!currentResult) return;
  const mineCount = currentResult.open.filter((pr) => currentAttentionUrls.includes(pr.url)).length;
  const followedCount = (currentResult.followed_open || []).filter((pr) => currentAttentionUrls.includes(pr.url)).length;
  const mergedCount = [
    ...currentResult.recently_merged,
    ...(currentResult.followed_recently_merged || []),
  ].filter((pr) => currentAttentionUrls.includes(pr.url)).length;
  const closedCount = [
    ...currentResult.recently_closed,
    ...(currentResult.followed_recently_closed || []),
  ].filter((pr) => currentAttentionUrls.includes(pr.url)).length;

  const counts: Record<string, number> = { mine: mineCount, followed: followedCount, merged: mergedCount, closed: closedCount };

  document.querySelectorAll("#main-nav .nav-item").forEach((btn) => {
    const tab = btn.getAttribute("data-tab")!;
    const count = counts[tab] || 0;
    const badge = btn.querySelector(".tab-badge");
    if (count > 0) {
      if (badge) {
        badge.textContent = String(count);
      } else {
        const span = document.createElement("span");
        span.className = "tab-badge";
        span.textContent = String(count);
        btn.appendChild(span);
      }
    } else if (badge) {
      badge.remove();
    }
  });
}

// ── Follow filter button badges ───────────────────────────────────────────────

export function updateFollowFilterBadges() {
  if (!currentResult || activeTab !== "followed") return;
  const allOpen = currentResult.followed_open || [];
  const attentionByUser: Record<string, number> = {};

  for (const pr of allOpen) {
    if (currentAttentionUrls.includes(pr.url)) {
      const u = pr.author.login;
      attentionByUser[u] = (attentionByUser[u] || 0) + 1;
    }
  }

  const totalAttention = Object.values(attentionByUser).reduce((a, b) => a + b, 0);

  // Update "All" button
  const allBtn = document.querySelector<HTMLButtonElement>(".follow-filter-btn[data-filter='all']");
  if (allBtn) {
    let badge = allBtn.querySelector<HTMLElement>(".tab-badge");
    if (totalAttention > 0) {
      if (badge) {
        badge.textContent = String(totalAttention);
      } else {
        const span = document.createElement("span");
        span.className = "tab-badge";
        span.textContent = String(totalAttention);
        allBtn.appendChild(span);
      }
    } else if (badge) {
      badge.remove();
    }
  }

  // Update user buttons
  document.querySelectorAll<HTMLButtonElement>(".follow-filter-btn[data-filter], .follow-filter-dropdown-item[data-filter]").forEach((btn) => {
    const user = btn.getAttribute("data-filter");
    if (user && user !== "all") {
      const count = attentionByUser[user] || 0;
      let badge = btn.querySelector<HTMLElement>(".tab-badge");
      if (count > 0) {
        if (badge) {
          badge.textContent = String(count);
        } else {
          const span = document.createElement("span");
          span.className = "tab-badge";
          span.textContent = String(count);
          btn.appendChild(span);
        }
      } else if (badge) {
        badge.remove();
      }
    }
  });
}

// ── Content events ────────────────────────────────────────────────────────────

export function bindContentEvents(container: HTMLElement) {
  const readyToHover = Date.now();

  // PR card: click to open, hover to dismiss attention
  container.querySelectorAll(".pr-card").forEach((card) => {
    card.addEventListener("click", () => {
      const url = card.getAttribute("data-url");
      if (url) openUrl(url);
      if (card.classList.contains("attention")) {
        if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
        card.classList.remove("attention");
        if (url) {
          if (currentResult?.element_changes) delete currentResult.element_changes[url];
          setCurrentAttentionUrls(currentAttentionUrls.filter((u) => u !== url));
          invoke("dismiss_pr", { url });
        }
        updateTabBadges();
        updateFollowFilterBadges();
      }
    });

    // Copy button
    const copyBtn = card.querySelector<HTMLButtonElement>(".copy-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const url = card.getAttribute("data-url");
        if (url) {
          navigator.clipboard.writeText(url).then(() => {
            copyBtn.classList.add("copied");
            setTimeout(() => copyBtn.classList.remove("copied"), 1500);
          });
        }
      });
    }

    let dismissTimer: ReturnType<typeof setTimeout> | null = null;
    let hoverActive = false;
    card.addEventListener("mouseenter", () => {
      if (Date.now() - readyToHover < 500) return;
      hoverActive = true;
      const url = card.getAttribute("data-url");
      // Prevent re-adding highlights on next render
      if (url && currentResult?.element_changes) {
        delete currentResult.element_changes[url];
      }
      if (card.classList.contains("attention")) {
        dismissTimer = setTimeout(() => {
          card.classList.remove("attention");
          if (url) {
            setCurrentAttentionUrls(currentAttentionUrls.filter((u) => u !== url));
            invoke("dismiss_pr", { url });
          }
          updateTabBadges();
          updateFollowFilterBadges();
        }, 300);
      }
    });
    card.addEventListener("mouseleave", () => {
      if (dismissTimer) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
      }
      // Remove highlight classes after hover — color fades via transition on .status-detail
      if (hoverActive) {
        hoverActive = false;
        card.querySelectorAll<HTMLElement>(".status-detail.highlight-attention")
          .forEach((el) => el.classList.remove("highlight-attention"));
        card.querySelectorAll<HTMLElement>(".highlight-changed")
          .forEach((el) => el.classList.remove("highlight-changed"));
      }
    });
  });

  // Accordion toggle: persist collapsed state
  container.querySelectorAll("details[data-accordion-id]").forEach((el) => {
    el.addEventListener("toggle", () => {
      const id = el.getAttribute("data-accordion-id")!;
      if ((el as HTMLDetailsElement).open) {
        collapsedAccordions.delete(id);
      } else {
        collapsedAccordions.add(id);
      }
      persistPrefs();
    });
  });

  // Fav / hide buttons
  container.querySelectorAll(".fav-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const type = btn.getAttribute("data-fav-type") as "org" | "repo";
      const key = btn.getAttribute("data-fav-key")!;
      toggleFavorite(type, key);
    });
  });

  container.querySelectorAll(".hide-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const type = btn.getAttribute("data-hide-type") as "org" | "repo";
      const key = btn.getAttribute("data-hide-key")!;
      toggleHidden(type, key);
    });
  });
}

// ── Hide PR (keyboard shortcut 'i') ──────────────────────────────────────────

export async function hideCurrentFocusPr(focusIndex: number): Promise<boolean> {
  const content = document.getElementById("content")!;
  const items = [...content.querySelectorAll("summary.accordion-header, .pr-card")];
  if (focusIndex < 0 || focusIndex >= items.length) return false;

  const el = items[focusIndex];
  if (!el.classList.contains("pr-card")) return false;

  const url = el.getAttribute("data-url");
  const title = el.getAttribute("data-title") || "";
  if (!url) return false;

  hiddenPrs.set(url, title);
  if (currentResult) {
    currentResult.open = currentResult.open.filter((pr) => pr.url !== url);
    currentResult.recently_merged = currentResult.recently_merged.filter((pr) => pr.url !== url);
    currentResult.recently_closed = currentResult.recently_closed.filter((pr) => pr.url !== url);
    currentResult.followed_open = currentResult.followed_open.filter((pr) => pr.url !== url);
    currentResult.followed_recently_merged = currentResult.followed_recently_merged.filter((pr) => pr.url !== url);
    currentResult.followed_recently_closed = currentResult.followed_recently_closed.filter((pr) => pr.url !== url);
  }
  renderActiveTab();

  const current = await invoke<import("./types").Settings>("get_settings");
  current.hidden_prs = [...hiddenPrs.entries()].map(([u, t]) => ({ url: u, title: t }));
  await invoke("update_settings", { settings: current });

  return true;
}
