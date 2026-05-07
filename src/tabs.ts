import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Settings, TabName } from "./types";
import {
  currentResult,
  currentAttentionUrls,
  setCurrentAttentionUrls,
  activeTab,
  setActiveTabState,
  activeWatchFilter,
  setActiveWatchFilter,
  setShowAuthorInCards,
  hiddenOrgs,
  hiddenRepos,
  groupByRepository,
  collapsedAccordions,
  hiddenPrs,
  watchedUsers,
  watchedPrs,
  searchQuery,
  setSearchQuery,
  setFocusIndex,
  autoWatchedPrUrls,
  unseenRequestUrls,
  removeUnseenRequestUrl,
  ignoredLabels,
  requestsLabelHintDismissed,
  setRequestsLabelHintDismissed,
} from "./state";
import {
  filterPrs,
  renderAccordionContent,
  renderFlatList,
  renderCollapsibleSection,
} from "./renderer";
import { persistPrefs, toggleFavorite, toggleHidden } from "./prefs";

// Injected callback for showSettings (wired in main.ts to avoid circular dep)
let _showSettings: (tab?: string, focusId?: string) => void = () => {};
export function initTabs(showSettingsFn: (tab?: string, focusId?: string) => void) {
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

  } else if (activeTab === "requests") {
    if (!requestsLabelHintDismissed && ignoredLabels.length === 0) {
      html += `<div class="tab-hint">Hide PRs by label in <a class="tab-hint-link" data-action="open-settings">Settings → Subscriptions</a>. <button class="tab-hint-dismiss" data-action="dismiss-label-hint" aria-label="Dismiss">✕</button></div>`;
    }
    const prs = (currentResult.review_requests || []).filter(
      (pr) => !watchedPrs.has(pr.url)
    );
    if (prs.length === 0) {
      html += '<div class="empty">No review requests</div>';
    } else {
      setShowAuthorInCards(true);
      const body = groupByRepository
        ? renderAccordionContent(prs, false, true)
        : renderFlatList(prs, true);
      html += body || '<div class="empty">No review requests</div>';
      setShowAuthorInCards(false);
    }

  } else if (activeTab === "watched") {
    if (watchedUsers.length === 0 && watchedPrs.size === 0) {
      html = '<div class="empty">No watched developers or PRs. Add some in Settings.</div>';
    } else {
      const allOpen = currentResult.watched_open || [];

      html += renderSearchBar();

      // Per-user filter bar (moved below search bar)
      if (watchedUsers.length > 1 || watchedPrs.size > 0) {
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
        let visibleUsers = [...watchedUsers];

        // If a specific user is selected, move them to the front to ensure visibility
        if (activeWatchFilter !== "all" && watchedUsers.includes(activeWatchFilter)) {
          const selectedIndex = visibleUsers.indexOf(activeWatchFilter);
          const selected = visibleUsers.splice(selectedIndex, 1)[0];
          visibleUsers.unshift(selected);
        }

        const inlineUsers = visibleUsers.slice(0, inlineCount);
        const moreUsers = visibleUsers.slice(inlineCount);

        html += `<div class="watch-filter-bar">
          <button class="watch-filter-btn${activeWatchFilter === "all" ? " active" : ""}" data-filter="all">All${totalAttention ? `<span class="tab-badge">${totalAttention}</span>` : ""}</button>
          ${watchedPrs.size > 0 ? `<button class="watch-filter-btn${activeWatchFilter === "direct" ? " active" : ""}" data-filter="direct">Direct</button>` : ""}
          ${inlineUsers
            .map((u) => {
              const count = attentionByUser[u] || 0;
              return `<button class="watch-filter-btn${activeWatchFilter === u ? " active" : ""}" data-filter="${u}">@${u}${count ? `<span class="tab-badge">${count}</span>` : ""}</button>`;
            })
            .join("")}
          ${moreUsers.length > 0 ? `
            <div class="watch-filter-dropdown-wrapper">
              <button class="watch-filter-btn watch-filter-more-btn" id="watch-filter-more">+${moreUsers.length}</button>
              <div class="watch-filter-dropdown" id="watch-filter-dropdown">
                ${moreUsers
                  .map((u) => {
                    const count = attentionByUser[u] || 0;
                    return `<button class="watch-filter-dropdown-item${activeWatchFilter === u ? " active" : ""}" data-filter="${u}">@${u}${count ? `<span class="tab-badge">${count}</span>` : ""}</button>`;
                  })
                  .join("")}
              </div>
            </div>
          ` : ""}
        </div>`;
      }

      // Apply filter (all, direct, or specific user)
      let byFilter = allOpen;
      if (activeWatchFilter === "direct") {
        byFilter = allOpen.filter((pr) => watchedPrs.has(pr.url));
      } else if (activeWatchFilter !== "all") {
        const filterLower = activeWatchFilter.toLowerCase();
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
    const watched = currentResult.watched_recently_merged || [];
    if (mine.length === 0 && watched.length === 0) {
      html = '<div class="empty">No recently merged PRs</div>';
    } else {
      if (mine.length > 0) html += renderCollapsibleSection("section:owned", "Owned", mine);
      if (watched.length > 0) {
        setShowAuthorInCards(true);
        html += renderCollapsibleSection("section:watched", "Watched", watched);
        setShowAuthorInCards(false);
      }
    }

  } else if (activeTab === "closed") {
    const mine = currentResult.recently_closed || [];
    const watched = currentResult.watched_recently_closed || [];
    if (mine.length === 0 && watched.length === 0) {
      html = '<div class="empty">No recently closed PRs</div>';
    } else {
      if (mine.length > 0) html += renderCollapsibleSection("section:owned", "Owned", mine);
      if (watched.length > 0) {
        setShowAuthorInCards(true);
        html += renderCollapsibleSection("section:watched", "Watched", watched);
        setShowAuthorInCards(false);
      }
    }
  }

  if (!html) html = '<div class="empty">No PRs</div>';
  content.innerHTML = html;
  bindContentEvents(content);

  // Bind watch filter buttons (all, direct, user filters)
  content.querySelectorAll<HTMLButtonElement>(".watch-filter-btn[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setActiveWatchFilter(btn.getAttribute("data-filter") || "all");
      renderActiveTab();
    });
  });

  // Bind dropdown items
  content.querySelectorAll<HTMLButtonElement>(".watch-filter-dropdown-item").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setActiveWatchFilter(btn.getAttribute("data-filter") || "all");
      renderActiveTab();
    });
  });

  // Toggle dropdown on more button click
  const moreBtn = content.querySelector<HTMLButtonElement>("#watch-filter-more");
  const dropdown = content.querySelector<HTMLElement>("#watch-filter-dropdown");
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
  if (activeTab === "mine" || activeTab === "watched") {
    bindSearchEvents(content);
  }

  updateTabBadges();
}

// ── Set active tab ────────────────────────────────────────────────────────────

export function setActiveTab(tab: TabName) {
  // Collapse avatar menu on tab switch + reset sign-out confirmation
  const menu = document.getElementById("avatar-menu");
  if (menu?.classList.contains("open")) {
    menu.classList.remove("open");
    const signoutBtn = document.getElementById("signout-btn");
    const signoutLabel = signoutBtn?.querySelector<HTMLElement>(".popover-label");
    if (signoutBtn && signoutLabel) {
      signoutBtn.classList.remove("confirming");
      signoutLabel.textContent = "Sign out";
    }
  }

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
  const watchedCount = (currentResult.watched_open || []).filter((pr) => currentAttentionUrls.includes(pr.url)).length;
  const mergedCount = [
    ...currentResult.recently_merged,
    ...(currentResult.watched_recently_merged || []),
  ].filter((pr) => currentAttentionUrls.includes(pr.url)).length;
  const closedCount = [
    ...currentResult.recently_closed,
    ...(currentResult.watched_recently_closed || []),
  ].filter((pr) => currentAttentionUrls.includes(pr.url)).length;

  const requestsCount = (currentResult.review_requests || []).filter(
    (pr) => !watchedPrs.has(pr.url)
  ).length;
  const counts: Record<string, number> = { mine: mineCount, requests: requestsCount, watched: watchedCount, merged: mergedCount, closed: closedCount };

  document.querySelectorAll("#main-nav .nav-item").forEach((btn) => {
    const tab = btn.getAttribute("data-tab")!;
    const count = counts[tab] || 0;
    const badge = btn.querySelector(".tab-badge");
    const isCount = tab === "requests";
    if (count > 0) {
      if (badge) {
        badge.classList.toggle("tab-badge--count", isCount);
        badge.textContent = String(count);
      } else {
        const span = document.createElement("span");
        span.className = isCount ? "tab-badge tab-badge--count" : "tab-badge";
        span.textContent = String(count);
        btn.appendChild(span);
      }
    } else if (badge) {
      badge.remove();
    }
    if (tab === "requests") {
      btn.classList.toggle("has-unseen-requests", unseenRequestUrls.size > 0);
    }
  });
}

// ── Watch filter button badges ───────────────────────────────────────────────

function updateWatchFilterBadges() {
  if (!currentResult || activeTab !== "watched") return;
  const allOpen = currentResult.watched_open || [];
  const attentionByUser: Record<string, number> = {};

  for (const pr of allOpen) {
    if (currentAttentionUrls.includes(pr.url)) {
      const u = pr.author.login;
      attentionByUser[u] = (attentionByUser[u] || 0) + 1;
    }
  }

  const totalAttention = Object.values(attentionByUser).reduce((a, b) => a + b, 0);

  // Update "All" button
  const allBtn = document.querySelector<HTMLButtonElement>(".watch-filter-btn[data-filter='all']");
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
  document.querySelectorAll<HTMLButtonElement>(".watch-filter-btn[data-filter], .watch-filter-dropdown-item[data-filter]").forEach((btn) => {
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

  // Tab hint: open settings or dismiss
  container.querySelector<HTMLElement>('[data-action="open-settings"]')?.addEventListener("click", (e) => {
    e.preventDefault();
    setActiveTabState("settings");
    _showSettings("subscriptions", "ignored-label-input");
  });
  container.querySelector<HTMLElement>('[data-action="dismiss-label-hint"]')?.addEventListener("click", () => {
    setRequestsLabelHintDismissed(true);
    container.querySelector<HTMLElement>(".tab-hint")?.remove();
    invoke<object>("get_settings").then((s) =>
      invoke("update_settings", { settings: { ...s, requests_label_hint_dismissed: true } })
    ).catch(() => {});
  });

  // PR card: click to open, hover to dismiss attention
  container.querySelectorAll(".pr-card").forEach((card) => {
    card.addEventListener("click", () => {
      const url = card.getAttribute("data-url");
      if (url) openUrl(url);
      if (url && card.classList.contains("auto-watched-new")) {
        autoWatchedPrUrls.delete(url);
        card.classList.remove("auto-watched-new");
      }
      if (card.classList.contains("attention")) {
        if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
        card.classList.remove("attention");
        if (url) {
          if (currentResult?.element_changes) delete currentResult.element_changes[url];
          removeUnseenRequestUrl(url);
          setCurrentAttentionUrls(currentAttentionUrls.filter((u) => u !== url));
          invoke("dismiss_pr", { url });
        }
        updateTabBadges();
        updateWatchFilterBadges();
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
            removeUnseenRequestUrl(url);
            setCurrentAttentionUrls(currentAttentionUrls.filter((u) => u !== url));
            invoke("dismiss_pr", { url });
          }
          updateTabBadges();
          updateWatchFilterBadges();
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
        const url = card.getAttribute("data-url");
        if (url && card.classList.contains("auto-watched-new")) {
          autoWatchedPrUrls.delete(url);
          card.classList.remove("auto-watched-new");
        }
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

  container.querySelectorAll(".open-gh-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const url = btn.getAttribute("data-gh-url");
      if (url) openUrl(url);
    });
  });

  // Cmd+click on accordion label opens org/repo on GitHub
  container.querySelectorAll(".accordion-label").forEach((label) => {
    label.addEventListener("click", (e) => {
      if (!(e as MouseEvent).metaKey) return;
      e.stopPropagation();
      e.preventDefault();
      const details = label.closest("details[data-accordion-id]");
      if (!details) return;
      const id = details.getAttribute("data-accordion-id") || "";
      const key = id.replace(/^(org|repo):/, "");
      if (key) openUrl(`https://github.com/${key}`);
    });
  });
}

// ── Tab ordering ─────────────────────────────────────────────────────────────

const DEFAULT_TAB_ORDER = ["mine", "requests", "watched", "merged", "closed"];

export function applyTabOrder(order: string[]) {
  const nav = document.getElementById("main-nav");
  const spacer = nav?.querySelector<HTMLElement>(".nav-spacer");
  if (!nav || !spacer) return;

  const btnMap = new Map<string, HTMLElement>();
  nav.querySelectorAll<HTMLElement>(".nav-item[data-tab]").forEach((btn) => {
    const tab = btn.getAttribute("data-tab");
    if (tab) btnMap.set(tab, btn);
  });

  // Stored order first, then any tabs missing from it (forward-compat)
  const effective = order.filter((t) => btnMap.has(t));
  for (const t of DEFAULT_TAB_ORDER) {
    if (!effective.includes(t)) effective.push(t);
  }

  for (const tab of effective) {
    const btn = btnMap.get(tab);
    if (btn) nav.insertBefore(btn, spacer);
  }
}

export function initTabDragDrop() {
  const nav = document.getElementById("main-nav");
  if (!nav) return;

  let dragBtn: HTMLElement | null = null;
  let ghost: HTMLElement | null = null;
  let placeholder: HTMLElement | null = null;
  let offsetY = 0;
  let startY = 0;
  let active = false;

  function getInsertRef(clientY: number): Element {
    for (const b of nav!.querySelectorAll<HTMLElement>(".nav-item[data-tab]")) {
      if (b === dragBtn) continue;
      const r = b.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return b;
    }
    return nav!.querySelector(".nav-spacer")!;
  }

  function clearTransforms() {
    nav!.querySelectorAll<HTMLElement>(".nav-item[data-tab]").forEach((b) => {
      b.style.transition = "";
      b.style.transform = "";
    });
  }

  // FLIP: record positions → move placeholder → invert + animate to new positions
  function movePlaceholder(clientY: number) {
    const ref = getInsertRef(clientY);
    if (placeholder!.nextSibling === ref) return;

    const btns = [...nav!.querySelectorAll<HTMLElement>(".nav-item[data-tab]")]
      .filter((b) => b !== dragBtn);
    const before = btns.map((b) => b.getBoundingClientRect().top);

    nav!.insertBefore(placeholder!, ref);

    btns.forEach((b, i) => {
      const delta = before[i] - b.getBoundingClientRect().top;
      if (Math.abs(delta) < 1) return;
      b.style.transition = "none";
      b.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          b.style.transition = "transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
          b.style.transform = "";
        })
      );
    });
  }

  nav.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".nav-item[data-tab]");
    if (!btn) return;
    dragBtn = btn;
    startY = e.clientY;
    offsetY = e.clientY - btn.getBoundingClientRect().top;
  });

  nav.addEventListener("pointermove", (e) => {
    if (!dragBtn) return;

    if (!active) {
      if (Math.abs(e.clientY - startY) < 5) return;
      active = true;
      nav.setPointerCapture(e.pointerId);

      const rect = dragBtn.getBoundingClientRect();

      // Clone before hiding so the clone doesn't inherit display:none
      ghost = dragBtn.cloneNode(true) as HTMLElement;

      placeholder = document.createElement("div");
      placeholder.className = "tab-drag-placeholder";
      placeholder.style.height = `${rect.height}px`;
      nav!.insertBefore(placeholder, dragBtn);
      dragBtn.style.display = "none";
      ghost.classList.add("tab-drag-ghost");
      Object.assign(ghost.style, {
        position: "fixed",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        zIndex: "9999",
        pointerEvents: "none",
        opacity: "0",
        transform: "scale(0.95)",
        transition: "opacity 0.12s ease, transform 0.12s ease, box-shadow 0.12s ease",
      });
      document.body.appendChild(ghost);
      requestAnimationFrame(() => {
        ghost!.style.opacity = "0.92";
        ghost!.style.transform = "scale(1.06)";
      });

      const suppressClick = (ev: Event) => {
        ev.stopImmediatePropagation();
        nav!.removeEventListener("click", suppressClick, true);
      };
      nav.addEventListener("click", suppressClick, true);
    }

    ghost!.style.top = `${e.clientY - offsetY}px`;
    movePlaceholder(e.clientY);
  });

  nav.addEventListener("pointerup", async (_e) => {
    if (!dragBtn) return;
    const btn = dragBtn;
    const currentGhost = ghost;
    const currentPlaceholder = placeholder;
    dragBtn = null;
    ghost = null;
    placeholder = null;

    if (!active) return;
    active = false;

    clearTransforms();

    // Ghost fades out
    if (currentGhost) {
      Object.assign(currentGhost.style, {
        transition: "opacity 0.12s ease, transform 0.12s ease",
        opacity: "0",
        transform: "scale(0.92)",
      });
      setTimeout(() => currentGhost.remove(), 130);
    }

    // Button pops in at the placeholder position
    btn.style.display = "";
    btn.style.transition = "none";
    btn.style.transform = "scale(0.88)";
    btn.style.opacity = "0";
    nav!.insertBefore(btn, currentPlaceholder!);
    currentPlaceholder!.remove();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        btn.style.transition = "transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.12s ease";
        btn.style.transform = "";
        btn.style.opacity = "";
        setTimeout(() => {
          btn.style.transition = "";
        }, 220);
      })
    );

    const order = [...nav!.querySelectorAll<HTMLElement>(".nav-item[data-tab]")]
      .map((b) => b.getAttribute("data-tab")!);
    const current = await invoke<Settings>("get_settings");
    await invoke("update_settings", { settings: { ...current, tab_order: order } });
  });

  nav.addEventListener("pointercancel", () => {
    if (!dragBtn) return;
    if (active) {
      ghost?.remove();
      dragBtn.style.display = "";
      placeholder?.remove();
      clearTransforms();
    }
    dragBtn = null;
    ghost = null;
    placeholder = null;
    active = false;
  });
}

// ── Hide PR (keyboard shortcut 'i') ──────────────────────────────────────────

export async function hideCurrentFocusPr(focusIndex: number): Promise<boolean> {
  const content = document.getElementById("content")!;
  const items = [...content.querySelectorAll(
    "#pr-search-input, .watch-filter-btn[data-filter], summary.accordion-header, .pr-card"
  )];
  if (focusIndex < 0 || focusIndex >= items.length) return false;

  const el = items[focusIndex];
  if (!el.classList.contains("pr-card")) return false;

  const url = el.getAttribute("data-url");
  const title = el.getAttribute("data-title") || "";
  if (!url) return false;

  // Animate out, then perform the actual hide
  el.classList.add("card-exit-hidden");

  await new Promise<void>((resolve) => {
    setTimeout(() => {
      const wasDirectWatch = watchedPrs.has(url);
      if (wasDirectWatch) {
        watchedPrs.delete(url);
      }
      hiddenPrs.set(url, title);

      if (currentResult) {
        currentResult.open = currentResult.open.filter((pr) => pr.url !== url);
        currentResult.recently_merged = currentResult.recently_merged.filter((pr) => pr.url !== url);
        currentResult.recently_closed = currentResult.recently_closed.filter((pr) => pr.url !== url);
        currentResult.watched_open = currentResult.watched_open.filter((pr) => pr.url !== url);
        currentResult.watched_recently_merged = currentResult.watched_recently_merged.filter((pr) => pr.url !== url);
        currentResult.watched_recently_closed = currentResult.watched_recently_closed.filter((pr) => pr.url !== url);
      }
      renderActiveTab();
      resolve();
    }, 400);
  });

  const current = await invoke<import("./types").Settings>("get_settings");
  current.hidden_prs = [...hiddenPrs.entries()].map(([u, t]) => ({ url: u, title: t }));
  current.watched_prs = [...watchedPrs];
  await invoke("update_settings", { settings: current });

  return true;
}
