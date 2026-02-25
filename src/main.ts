import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";

interface Reviews {
  totalCount: number;
}

interface MergeQueueEntry {
  position: number;
}

interface Owner {
  login: string;
}

interface Repository {
  name: string;
  owner: Owner;
}

interface Comments {
  totalCount: number;
}

interface StatusCheckRollup {
  state: string;
}

interface Commit {
  statusCheckRollup: StatusCheckRollup | null;
}

interface CommitNode {
  commit: Commit;
}

interface CommitConnection {
  nodes: CommitNode[];
}

interface ReviewThread {
  isResolved: boolean;
}

interface ReviewThreads {
  nodes: ReviewThread[];
}

interface PullRequest {
  title: string;
  url: string;
  state: string;
  merged: boolean;
  createdAt: string;
  repository: Repository;
  mergeQueueEntry: MergeQueueEntry | null;
  reviewDecision: string | null;
  reviews: Reviews;
  comments: Comments;
  reviewThreads: ReviewThreads;
  commits: CommitConnection;
}

interface FetchResult {
  open: PullRequest[];
  recently_merged: PullRequest[];
  attention_urls: string[];
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface Settings {
  poll_interval_secs: number;
  notifications_enabled: boolean;
  show_recently_merged: boolean;
  merged_window_hours: number;
  favorite_orgs: string[];
  favorite_repos: string[];
  collapsed_accordions: string[];
  hidden_orgs: string[];
  hidden_repos: string[];
}

function getStatus(pr: PullRequest): { label: string; class: string } {
  if (pr.mergeQueueEntry) {
    return { label: "◎", class: "in-queue" };
  }
  if (pr.state === "OPEN") {
    return { label: "●", class: "open" };
  }
  if (pr.merged) {
    return { label: "✓", class: "merged" };
  }
  return { label: "✗", class: "closed" };
}

function getChecksLabel(pr: PullRequest): { text: string; class: string } {
  const rollup = pr.commits.nodes[0]?.commit.statusCheckRollup;
  if (!rollup) {
    return { text: "no checks", class: "checks-none" };
  }
  switch (rollup.state) {
    case "SUCCESS":
      return { text: "checks passed", class: "checks-pass" };
    case "FAILURE":
    case "ERROR":
      return { text: "checks failed", class: "checks-fail" };
    case "PENDING":
    case "EXPECTED":
      return { text: "checks running", class: "checks-pending" };
    default:
      return { text: rollup.state.toLowerCase(), class: "checks-none" };
  }
}

function getReviewStatus(pr: PullRequest): {
  reviewText: string;
  statusText: string | null;
  statusClass: string;
} {
  const approvals = pr.reviews.totalCount;
  const reviewText = `☑ ${approvals}`;

  switch (pr.reviewDecision) {
    case "APPROVED":
      return { reviewText, statusText: "approved", statusClass: "approved" };
    case "CHANGES_REQUESTED":
      return { reviewText, statusText: "changes requested", statusClass: "changes-requested" };
    case "REVIEW_REQUIRED":
      return { reviewText, statusText: "needs reviews", statusClass: "needs-reviews" };
    default:
      return { reviewText, statusText: null, statusClass: "" };
  }
}

let currentAttentionUrls: string[] = [];
let currentResult: FetchResult | null = null;
let activeTab: "open" | "merged" = "open";
let favoriteOrgs = new Set<string>();
let favoriteRepos = new Set<string>();
let collapsedAccordions = new Set<string>();
let hiddenOrgs = new Set<string>();
let hiddenRepos = new Set<string>();
let pendingUnhideOrgs = new Set<string>();
let pendingUnhideRepos = new Set<string>();
let savePending = false;
let focusIndex = -1;

function getFocusables(): Element[] {
  const content = document.getElementById("content")!;
  return [...content.querySelectorAll("summary.accordion-header, .pr-card")];
}

function setFocus(index: number) {
  const items = getFocusables();
  if (items.length === 0) return;

  const prev = document.querySelector(".kb-focus");
  if (prev) prev.classList.remove("kb-focus");

  focusIndex = Math.max(0, Math.min(index, items.length - 1));
  const el = items[focusIndex];
  el.classList.add("kb-focus");
  el.scrollIntoView({ block: "nearest" });
}

async function loadUserPrefs() {
  const s = await invoke<Settings>("get_settings");
  favoriteOrgs = new Set(s.favorite_orgs);
  favoriteRepos = new Set(s.favorite_repos);
  collapsedAccordions = new Set(s.collapsed_accordions);
  hiddenOrgs = new Set(s.hidden_orgs);
  hiddenRepos = new Set(s.hidden_repos);
}

async function persistPrefs() {
  if (savePending) return;
  savePending = true;
  queueMicrotask(async () => {
    savePending = false;
    const current = await invoke<Settings>("get_settings");
    current.favorite_orgs = [...favoriteOrgs];
    current.favorite_repos = [...favoriteRepos];
    current.collapsed_accordions = [...collapsedAccordions];
    current.hidden_orgs = [...hiddenOrgs];
    current.hidden_repos = [...hiddenRepos];
    await invoke("update_settings", { settings: current });
  });
}

function renderPrCard(pr: PullRequest): string {
  const status = getStatus(pr);
  const { reviewText, statusText, statusClass } = getReviewStatus(pr);
  const checks = getChecksLabel(pr);

  const statusParts: string[] = [];
  if (statusText) {
    statusParts.push(`<span class="${statusClass}">${statusText}</span>`);
  }
  statusParts.push(`<span class="${checks.class}">${checks.text}</span>`);

  return `
    <div class="pr-card${currentAttentionUrls.includes(pr.url) ? " attention" : ""}" data-url="${pr.url}">
      <div class="pr-status ${status.class}">${status.label}</div>
      <div class="pr-info">
        <div class="pr-title">${pr.title}</div>
        <div class="pr-meta">
          <span class="pr-reviews">${reviewText}</span>
          <span class="meta-sep">·</span>
          <span class="pr-comments"><svg class="comment-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2v2.543L9.06 10.5h4.19a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg> ${pr.comments.totalCount + pr.reviewThreads.nodes.filter(t => !t.isResolved).length}</span>
          <span class="meta-sep">·</span>
          <span class="pr-resolved">▣ ${pr.reviewThreads.nodes.filter(t => t.isResolved).length}</span>
        </div>
        <div class="pr-status-line">${statusParts.join('<span class="status-sep"> · </span>')}</div>
      </div>
    </div>
  `;
}

type GroupedPrs = [string, [string, PullRequest[]][]][];

function groupPrs(prs: PullRequest[]): GroupedPrs {
  const orgMap = new Map<string, Map<string, PullRequest[]>>();

  const sorted = [...prs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  for (const pr of sorted) {
    const org = pr.repository.owner.login;
    const repo = pr.repository.name;

    if (!orgMap.has(org)) orgMap.set(org, new Map());
    const repos = orgMap.get(org)!;
    if (!repos.has(repo)) repos.set(repo, []);
    repos.get(repo)!.push(pr);
  }

  const sortedOrgs = [...orgMap.entries()].sort((a, b) => {
    const aRank = hiddenOrgs.has(a[0]) ? 2 : favoriteOrgs.has(a[0]) ? 0 : 1;
    const bRank = hiddenOrgs.has(b[0]) ? 2 : favoriteOrgs.has(b[0]) ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return a[0].localeCompare(b[0]);
  });

  return sortedOrgs.map(([org, repoMap]) => {
    const sortedRepos = [...repoMap.entries()].sort((a, b) => {
      const aKey = `${org}/${a[0]}`;
      const bKey = `${org}/${b[0]}`;
      const aRank = hiddenRepos.has(aKey) ? 2 : favoriteRepos.has(aKey) ? 0 : 1;
      const bRank = hiddenRepos.has(bKey) ? 2 : favoriteRepos.has(bKey) ? 0 : 1;
      if (aRank !== bRank) return aRank - bRank;
      return a[0].localeCompare(b[0]);
    });
    return [org, sortedRepos];
  });
}

function toggleFavorite(type: "org" | "repo", key: string) {
  const set = type === "org" ? favoriteOrgs : favoriteRepos;
  if (set.has(key)) {
    set.delete(key);
  } else {
    set.add(key);
  }
  persistPrefs();
  renderActiveTab();
}

async function toggleHidden(type: "org" | "repo", key: string) {
  const set = type === "org" ? hiddenOrgs : hiddenRepos;
  const pendingSet = type === "org" ? pendingUnhideOrgs : pendingUnhideRepos;
  if (set.has(key)) {
    set.delete(key);
    pendingSet.add(key);
  } else {
    set.add(key);
    pendingSet.delete(key);
  }
  renderActiveTab();
  const current = await invoke<Settings>("get_settings");
  current.favorite_orgs = [...favoriteOrgs];
  current.favorite_repos = [...favoriteRepos];
  current.collapsed_accordions = [...collapsedAccordions];
  current.hidden_orgs = [...hiddenOrgs];
  current.hidden_repos = [...hiddenRepos];
  await invoke("update_settings", { settings: current });
  loadPrs();
}

function renderActionButtons(type: "org" | "repo", key: string): string {
  const favSet = type === "org" ? favoriteOrgs : favoriteRepos;
  const hideSet = type === "org" ? hiddenOrgs : hiddenRepos;
  const isFav = favSet.has(key);
  const isHidden = hideSet.has(key);
  return `<button class="hide-btn${isHidden ? " active" : ""}" data-hide-type="${type}" data-hide-key="${key}">${isHidden ? "◌" : "◉"}</button><button class="fav-btn${isFav ? " active" : ""}" data-fav-type="${type}" data-fav-key="${key}">${isFav ? "★" : "☆"}</button>`;
}

function renderRepoAccordion(org: string, repo: string, prs: PullRequest[], isHidden: boolean): string {
  const repoKey = `${org}/${repo}`;
  const repoId = `repo:${repoKey}`;
  const repoOpen = collapsedAccordions.has(repoId) ? "" : " open";
  const cls = isHidden ? " hidden-accordion" : "";
  let html = `<details class="accordion repo-accordion${cls}" data-accordion-id="${repoId}"${repoOpen}>`;
  html += `<summary class="accordion-header repo-header"><span class="accordion-chevron"></span><span class="accordion-label">${repo}</span><span class="accordion-count">${prs.length}</span>${renderActionButtons("repo", repoKey)}</summary>`;
  if (!isHidden) {
    html += prs.map(renderPrCard).join("");
  }
  html += `</details>`;
  return html;
}

function renderAccordionContent(prs: PullRequest[]): string {
  const grouped = groupPrs(prs);
  const renderedOrgs = new Set<string>();
  let html = "";

  if (prs.length === 0 && hiddenOrgs.size === 0 && hiddenRepos.size === 0 && pendingUnhideOrgs.size === 0 && pendingUnhideRepos.size === 0) {
    return '<div class="empty">No PRs</div>';
  }

  for (const [org, repos] of grouped) {
    renderedOrgs.add(org);
    const orgId = `org:${org}`;
    const orgOpen = collapsedAccordions.has(orgId) ? "" : " open";
    const orgIsHidden = hiddenOrgs.has(org);
    const cls = orgIsHidden ? " hidden-accordion" : "";
    html += `<details class="accordion org-accordion${cls}" data-accordion-id="${orgId}"${orgOpen}>`;
    html += `<summary class="accordion-header org-header"><span class="accordion-chevron"></span><span class="accordion-label">${org}</span>${renderActionButtons("org", org)}</summary>`;

    if (!orgIsHidden) {
      const renderedRepos = new Set<string>();
      for (const [repo, repoPrs] of repos) {
        renderedRepos.add(`${org}/${repo}`);
        html += renderRepoAccordion(org, repo, repoPrs, hiddenRepos.has(`${org}/${repo}`));
      }

      for (const repoKey of hiddenRepos) {
        if (renderedRepos.has(repoKey)) continue;
        const [rOrg, rRepo] = repoKey.split("/");
        if (rOrg !== org) continue;
        html += renderRepoAccordion(org, rRepo, [], true);
      }

      for (const repoKey of pendingUnhideRepos) {
        if (renderedRepos.has(repoKey)) continue;
        const [rOrg, rRepo] = repoKey.split("/");
        if (rOrg !== org) continue;
        html += renderRepoAccordion(org, rRepo, [], false);
      }
    }

    html += `</details>`;
  }

  for (const org of hiddenOrgs) {
    if (renderedOrgs.has(org)) continue;
    renderedOrgs.add(org);
    const orgId = `org:${org}`;
    const orgOpen = collapsedAccordions.has(orgId) ? "" : " open";
    html += `<details class="accordion org-accordion hidden-accordion" data-accordion-id="${orgId}"${orgOpen}>`;
    html += `<summary class="accordion-header org-header"><span class="accordion-chevron"></span><span class="accordion-label">${org}</span>${renderActionButtons("org", org)}</summary>`;
    html += `</details>`;
  }

  for (const org of pendingUnhideOrgs) {
    if (renderedOrgs.has(org)) continue;
    renderedOrgs.add(org);
    const orgId = `org:${org}`;
    const orgOpen = collapsedAccordions.has(orgId) ? "" : " open";
    html += `<details class="accordion org-accordion" data-accordion-id="${orgId}"${orgOpen}>`;
    html += `<summary class="accordion-header org-header"><span class="accordion-chevron"></span><span class="accordion-label">${org}</span>${renderActionButtons("org", org)}</summary>`;
    html += `</details>`;
  }

  const extraReposByOrg = new Map<string, { repo: string; hidden: boolean }[]>();
  for (const repoKey of hiddenRepos) {
    const [org, repo] = repoKey.split("/");
    if (renderedOrgs.has(org)) continue;
    if (!extraReposByOrg.has(org)) extraReposByOrg.set(org, []);
    extraReposByOrg.get(org)!.push({ repo, hidden: true });
  }
  for (const repoKey of pendingUnhideRepos) {
    const [org, repo] = repoKey.split("/");
    if (renderedOrgs.has(org)) continue;
    if (!extraReposByOrg.has(org)) extraReposByOrg.set(org, []);
    extraReposByOrg.get(org)!.push({ repo, hidden: false });
  }
  for (const [org, repos] of extraReposByOrg) {
    renderedOrgs.add(org);
    const orgId = `org:${org}`;
    const orgOpen = collapsedAccordions.has(orgId) ? "" : " open";
    html += `<details class="accordion org-accordion" data-accordion-id="${orgId}"${orgOpen}>`;
    html += `<summary class="accordion-header org-header"><span class="accordion-chevron"></span><span class="accordion-label">${org}</span>${renderActionButtons("org", org)}</summary>`;
    for (const { repo, hidden } of repos) {
      html += renderRepoAccordion(org, repo, [], hidden);
    }
    html += `</details>`;
  }

  if (html === "") {
    return '<div class="empty">No PRs</div>';
  }

  return html;
}

function updateTabBadges() {
  if (!currentResult) return;
  const openCount = currentResult.open.filter(pr => currentAttentionUrls.includes(pr.url)).length;
  const mergedCount = currentResult.recently_merged.filter(pr => currentAttentionUrls.includes(pr.url)).length;
  document.querySelectorAll(".tab-bar .tab").forEach((btn) => {
    const tab = btn.getAttribute("data-tab");
    const badge = btn.querySelector(".tab-badge");
    const count = tab === "open" ? openCount : mergedCount;
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

function renderActiveTab() {
  if (!currentResult) return;
  focusIndex = -1;
  const content = document.getElementById("content")!;
  const prs = activeTab === "open" ? currentResult.open : currentResult.recently_merged;
  content.innerHTML = renderAccordionContent(prs);
  bindContentEvents(content);
  updateTabBadges();
}

function setActiveTab(tab: "open" | "merged") {
  activeTab = tab;
  document.querySelectorAll(".tab-bar .tab").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tab);
  });
  renderActiveTab();
}

function bindContentEvents(container: HTMLElement) {
  const readyToHover = Date.now();
  container.querySelectorAll(".pr-card").forEach((card) => {
    card.addEventListener("click", () => {
      const url = card.getAttribute("data-url");
      if (url) openUrl(url);
    });

    let dismissTimer: ReturnType<typeof setTimeout> | null = null;
    card.addEventListener("mouseenter", () => {
      if (Date.now() - readyToHover < 500) return;
      if (card.classList.contains("attention")) {
        dismissTimer = setTimeout(() => {

          card.classList.remove("attention");
          const url = card.getAttribute("data-url");
          if (url) {
            currentAttentionUrls = currentAttentionUrls.filter(u => u !== url);
            invoke("dismiss_pr", { url });
          }
          updateTabBadges();
        }, 800);
      }
    });
    card.addEventListener("mouseleave", () => {
      if (dismissTimer) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
      }
    });
  });

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

function showLogin() {
  const content = document.getElementById("content")!;
  const signoutBtn = document.getElementById("signout-btn")!;
  const settingsBtn = document.getElementById("settings-btn")!;
  const tabBar = document.getElementById("tab-bar")!;
  signoutBtn.style.display = "none";
  settingsBtn.style.display = "none";
  tabBar.style.display = "none";

  content.innerHTML = `
    <div class="login-view">
      <div class="login-icon">🔑</div>
      <div class="login-title">Connect to GitHub</div>
      <div class="login-desc">Sign in to see your PRs.</div>
      <button id="login-btn" class="login-btn">Sign in with GitHub</button>
      <button id="pat-btn" class="login-btn login-btn-secondary">Use Personal Access Token</button>
    </div>
  `;

  document.getElementById("login-btn")!.addEventListener("click", startLogin);
  document.getElementById("pat-btn")!.addEventListener("click", showPatInput);
}

function showPermissionsInfo() {
  const content = document.getElementById("content")!;

  content.innerHTML = `
    <div class="login-view permissions-view">
      <div class="login-title">Required Permissions</div>

      <div class="perm-section">
        <div class="perm-section-title">Classic Token</div>
        <div class="perm-section-desc">Create at <a id="perm-classic-link" href="#" class="login-link">github.com/settings/tokens</a></div>
        <div class="perm-list">
          <div class="perm-item"><span class="perm-scope">repo</span> Full control of private repositories</div>
        </div>
      </div>

      <div class="perm-divider"></div>

      <div class="perm-section">
        <div class="perm-section-title">Fine-grained Token</div>
        <div class="perm-section-desc">Create at <a id="perm-fine-link" href="#" class="login-link">github.com/settings/tokens?type=beta</a></div>
        <div class="perm-list">
          <div class="perm-item"><span class="perm-scope">Contents</span> Read-only</div>
          <div class="perm-item"><span class="perm-scope">Metadata</span> Read-only</div>
          <div class="perm-item"><span class="perm-scope">Pull requests</span> Read-only</div>
        </div>
        <div class="perm-note">Select the repositories you want to monitor.</div>
      </div>

      <button id="perm-back-btn" class="login-btn login-btn-secondary">Back</button>
    </div>
  `;

  document.getElementById("perm-classic-link")!.addEventListener("click", (e) => {
    e.preventDefault();
    openUrl("https://github.com/settings/tokens");
  });

  document.getElementById("perm-fine-link")!.addEventListener("click", (e) => {
    e.preventDefault();
    openUrl("https://github.com/settings/tokens?type=beta");
  });

  document.getElementById("perm-back-btn")!.addEventListener("click", () => showPatInput());
}

function showPatInput() {
  const content = document.getElementById("content")!;

  content.innerHTML = `
    <div class="login-view">
      <div class="login-title">Personal Access Token</div>
      <div class="login-desc">Paste a token with the right permissions. <a id="perm-info-link" href="#" class="login-link">What permissions do I need?</a></div>
      <input id="pat-input" type="password" class="pat-input" placeholder="ghp_xxxxxxxxxxxx" autocomplete="off" spellcheck="false" />
      <div id="pat-error" class="pat-error"></div>
      <button id="pat-connect-btn" class="login-btn">Connect</button>
      <button id="pat-back-btn" class="login-btn login-btn-secondary">Back</button>
    </div>
  `;

  document.getElementById("perm-info-link")!.addEventListener("click", (e) => {
    e.preventDefault();
    showPermissionsInfo();
  });

  document.getElementById("pat-back-btn")!.addEventListener("click", () => showLogin());

  document.getElementById("pat-connect-btn")!.addEventListener("click", async () => {
    const input = document.getElementById("pat-input") as HTMLInputElement;
    const error = document.getElementById("pat-error")!;
    const btn = document.getElementById("pat-connect-btn") as HTMLButtonElement;
    const token = input.value.trim();

    if (!token) {
      error.textContent = "Please enter a token.";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Validating...";
    error.textContent = "";

    try {
      await invoke("login_with_pat", { token });
      await loadPrs();
    } catch (e) {
      error.textContent = "Invalid token. Please check and try again.";
      btn.disabled = false;
      btn.textContent = "Connect";
    }
  });

  document.getElementById("pat-input")!.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      document.getElementById("pat-connect-btn")!.click();
    }
  });
}

async function startLogin() {
  const content = document.getElementById("content")!;

  content.innerHTML = `<div class="login-view"><div class="login-desc">Connecting to GitHub...</div></div>`;

  try {
    const resp = await invoke<DeviceCodeResponse>("start_login");

    content.innerHTML = `
      <div class="login-view">
        <div class="login-title">Enter this code on GitHub</div>
        <div class="login-code" id="device-code" title="Click to copy">${resp.user_code}</div>
        <div id="copy-feedback" class="copy-feedback"></div>
        <div class="login-desc">
          Open <a id="verify-link" href="#" class="login-link">${resp.verification_uri}</a> and paste the code above.
        </div>
        <div class="login-status">Waiting for authorization...</div>
      </div>
    `;

    document.getElementById("device-code")!.addEventListener("click", async () => {
      await navigator.clipboard.writeText(resp.user_code);
      const feedback = document.getElementById("copy-feedback")!;
      feedback.textContent = "Copied!";
      setTimeout(() => { feedback.textContent = ""; }, 2000);
    });

    document.getElementById("verify-link")!.addEventListener("click", (e) => {
      e.preventDefault();
      openUrl(resp.verification_uri);
    });

    const interval = Math.max(resp.interval || 5, 8) * 1000;
    let polling = false;
    const poll = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const done = await invoke<boolean>("poll_login", { deviceCode: resp.device_code });
        if (done) {
          clearInterval(poll);
          await loadPrs();
          return;
        }
      } catch (e) {
        clearInterval(poll);
        content.innerHTML = `
          <div class="login-view">
            <div class="login-desc">Authorization failed. Please try again.</div>
            <button id="login-retry-btn" class="login-btn">Retry</button>
          </div>
        `;
        document.getElementById("login-retry-btn")!.addEventListener("click", () => showLogin());
      } finally {
        polling = false;
      }
    }, interval);
  } catch (e) {
    content.innerHTML = `
      <div class="login-view">
        <div class="login-desc">Failed to start login. Please try again.</div>
        <button id="login-retry-btn" class="login-btn">Retry</button>
      </div>
    `;
    document.getElementById("login-retry-btn")!.addEventListener("click", () => showLogin());
    console.error(e);
  }
}

function hideSettings() {
  document.getElementById("settings-panel")!.style.display = "none";
}

async function showSettings() {
  const panel = document.getElementById("settings-panel")!;
  const settings = await invoke<Settings>("get_settings");

  panel.innerHTML = `
    <div class="settings-view">
      <div class="settings-title">Settings</div>

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

      <div class="settings-actions">
        <button id="settings-save-btn" class="login-btn">Save</button>
        <button id="settings-back-btn" class="login-btn login-btn-secondary">Back</button>
      </div>
    </div>
  `;

  panel.style.display = "";

  document.getElementById("setting-merged")!.addEventListener("change", (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    document.getElementById("merged-window-group")!.style.display = checked ? "" : "none";
  });

  document.getElementById("settings-save-btn")!.addEventListener("click", async () => {
    const updated: Settings = {
      poll_interval_secs: parseInt((document.getElementById("setting-poll") as HTMLSelectElement).value),
      notifications_enabled: (document.getElementById("setting-notifications") as HTMLInputElement).checked,
      show_recently_merged: (document.getElementById("setting-merged") as HTMLInputElement).checked,
      merged_window_hours: parseInt((document.getElementById("setting-merged-hours") as HTMLSelectElement).value),
      favorite_orgs: [...favoriteOrgs],
      favorite_repos: [...favoriteRepos],
      collapsed_accordions: [...collapsedAccordions],
      hidden_orgs: [...hiddenOrgs],
      hidden_repos: [...hiddenRepos],
    };
    await invoke("update_settings", { settings: updated });
    hideSettings();
  });

  document.getElementById("settings-back-btn")!.addEventListener("click", hideSettings);
}

function renderPrView(result: FetchResult) {
  const signoutBtn = document.getElementById("signout-btn")!;
  const settingsBtn = document.getElementById("settings-btn")!;
  const tabBar = document.getElementById("tab-bar")!;

  signoutBtn.style.display = "";
  settingsBtn.style.display = "";
  tabBar.style.display = "";
  currentAttentionUrls = result.attention_urls;
  currentResult = result;
  pendingUnhideOrgs.clear();
  pendingUnhideRepos.clear();
  renderActiveTab();
}

async function loadPrs() {
  const content = document.getElementById("content")!;

  try {
    const result = await invoke<FetchResult>("fetch_prs");
    renderPrView(result);
  } catch (e: any) {
    if (typeof e === "string" && e.includes("not_authenticated")) {
      showLogin();
    } else {
      content.innerHTML = `<div class="empty">Failed to load PRs</div>`;
      console.error(e);
    }
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  await loadUserPrefs();

  const isAuthed = await invoke<boolean>("check_auth");
  if (isAuthed) {
    loadPrs();
  } else {
    showLogin();
  }

  listen("prs-updated", () => loadPrs());

  document.querySelectorAll(".tab-bar .tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab") as "open" | "merged";
      setActiveTab(tab);
    });
  });

  document.getElementById("settings-btn")?.addEventListener("click", () => showSettings());

  document.addEventListener("keydown", (e) => {
    const settingsOpen = document.getElementById("settings-panel")!.style.display !== "none";

    if (e.key === "Escape") {
      if (settingsOpen) {
        hideSettings();
      } else {
        getCurrentWindow().hide();
      }
      return;
    }

    if (settingsOpen || !currentResult) return;

    const items = getFocusables();
    if (!items.length && !["1", "2", "Tab"].includes(e.key)) return;

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
        setActiveTab("open");
        break;
      case "2":
        e.preventDefault();
        setActiveTab("merged");
        break;
      case "Tab":
        e.preventDefault();
        if (e.shiftKey) {
          setActiveTab(activeTab === "open" ? "merged" : "open");
        } else {
          setActiveTab(activeTab === "open" ? "merged" : "open");
        }
        break;
    }
  });

  document.getElementById("signout-btn")?.addEventListener("click", async () => {
    await invoke("logout");
    showLogin();
  });

  document.getElementById("quit-btn")?.addEventListener("click", async () => {
    const { exit } = await import("@tauri-apps/plugin-process");
    await exit(0);
  });
});
