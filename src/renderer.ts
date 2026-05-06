import type { PullRequest, FilterType } from "./types";
import {
  currentAttentionUrls,
  currentResult,
  showAuthorInCards,
  groupByRepository,
  favoriteOrgs,
  favoriteRepos,
  hiddenOrgs,
  hiddenRepos,
  collapsedAccordions,
  pendingUnhideOrgs,
  pendingUnhideRepos,
  autoWatchedPrUrls,
} from "./state";

type GroupedPrs = [string, [string, PullRequest[]][]][];

// ── Status helpers ────────────────────────────────────────────────────────────

export function getStatus(pr: PullRequest): { label: string; class: string } {
  if (pr.mergeQueueEntry) return { label: "◎", class: "in-queue" };
  if (pr.state === "OPEN" && pr.isDraft) return { label: "●", class: "draft" };
  if (pr.state === "OPEN") return { label: "●", class: "open" };
  if (pr.merged) return { label: "✓", class: "merged" };
  return { label: "✗", class: "closed" };
}

export function getChecksLabel(pr: PullRequest): { text: string; class: string } {
  const rollup = pr.commits.nodes[0]?.commit.statusCheckRollup;
  if (!rollup) return { text: "no checks", class: "checks-none" };
  switch (rollup.state) {
    case "SUCCESS":  return { text: "checks passed", class: "checks-pass" };
    case "FAILURE":
    case "ERROR":    return { text: "checks failed", class: "checks-fail" };
    case "PENDING":
    case "EXPECTED": return { text: "checks running", class: "checks-pending" };
    default:         return { text: rollup.state.toLowerCase(), class: "checks-none" };
  }
}

export function getReviewStatus(pr: PullRequest): {
  reviewText: string;
  statusText: string | null;
  statusClass: string;
} {
  const approvals = pr.reviews.totalCount;
  const reviewText = `☑ ${approvals}`;
  switch (pr.reviewDecision) {
    case "APPROVED":           return { reviewText, statusText: "approved", statusClass: "approved" };
    case "CHANGES_REQUESTED":  return { reviewText, statusText: "changes requested", statusClass: "changes-requested" };
    case "REVIEW_REQUIRED":    return { reviewText, statusText: "needs reviews", statusClass: "needs-reviews" };
    default:                   return { reviewText, statusText: null, statusClass: "" };
  }
}

// ── Filter ────────────────────────────────────────────────────────────────────

export function filterPrs(prs: PullRequest[], query: string, filter: FilterType): PullRequest[] {
  let result = prs;

  if (filter !== "all") {
    result = result.filter((pr) => {
      switch (filter) {
        case "needs-review":
          return pr.state === "OPEN" && (pr.reviewDecision === "REVIEW_REQUIRED" || pr.reviewDecision === null);
        case "changes-requested":
          return pr.reviewDecision === "CHANGES_REQUESTED";
        case "approved":
          return pr.reviewDecision === "APPROVED";
        case "failing": {
          const state = pr.commits.nodes[0]?.commit.statusCheckRollup?.state;
          return state === "FAILURE" || state === "ERROR";
        }
        case "attention":
          return currentAttentionUrls.includes(pr.url);
        default:
          return true;
      }
    });
  }

  if (query) {
    const q = query.toLowerCase();
    result = result.filter(
      (pr) =>
        pr.title.toLowerCase().includes(q) ||
        pr.repository.name.toLowerCase().includes(q) ||
        pr.repository.owner.login.toLowerCase().includes(q)
    );
  }

  return result;
}

// ── PR card ───────────────────────────────────────────────────────────────────

function getPrNumber(url: string): string {
  const match = url.match(/\/pull\/(\d+)$/);
  return match ? `#${match[1]}` : "";
}

export function renderPrCard(pr: PullRequest, minimal = false): string {
  const status = getStatus(pr);
  const { reviewText, statusText, statusClass } = getReviewStatus(pr);
  const checks = getChecksLabel(pr);
  const resolvedThreads = pr.reviewThreads.nodes.filter((t) => t.isResolved).length;
  const unresolvedThreadComments = pr.reviewThreads.nodes.filter((t) => !t.isResolved).reduce((sum, t) => sum + t.comments.totalCount, 0);
  const commentCount = pr.comments.totalCount + unresolvedThreadComments;
  const prNumber = getPrNumber(pr.url);

  const statusTitle =
    status.class === "in-queue" ? "In merge queue"
    : status.class === "draft"  ? "Draft PR"
    : status.class === "open"   ? "Open PR"
    : status.class === "merged" ? "Merged PR"
    : "Closed PR";

  // Highlight elements whose counts changed since the last poll (backend-tracked)
  const changes = currentResult?.element_changes[pr.url];
  const reviewChangedClass = (changes?.became_review_required || changes?.became_changes_requested || changes?.became_approved) ? " highlight-changed" : "";
  const checksChangedClass = changes?.checks_failed ? " highlight-changed" : "";
  const commentsClass = changes?.new_comment ? " highlight-attention" : "";

  const statusParts: string[] = [];
  if (!minimal) {
    if (pr.isDraft) {
      statusParts.push(`<span class="draft-label">draft</span>`);
    }
    if (pr.mergeQueueEntry) {
      statusParts.push(`<span class="in-queue-text">in queue #${pr.mergeQueueEntry.position}</span>`);
      statusParts.push(`<span class="status-detail" title="Approvals">${reviewText}</span>`);
    } else {
      if (statusText && !pr.isDraft) statusParts.push(`<span class="${statusClass}${reviewChangedClass}">${statusText}</span>`);
      statusParts.push(`<span class="${checks.class}${checksChangedClass}">${checks.text}</span>`);
      if (!pr.isDraft) statusParts.push(`<span class="status-detail" title="Approvals">${reviewText}</span>`);
    }
    statusParts.push(`<span class="status-detail${commentsClass}" title="Comments and unresolved threads"><svg class="comment-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2v2.543L9.06 10.5h4.19a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg> ${commentCount}</span>`);
    statusParts.push(`<span class="status-detail" title="Resolved threads">▣ ${resolvedThreads}</span>`);
  }

  const isAttention = currentAttentionUrls.includes(pr.url);
  const autoWatchedClass = !minimal && autoWatchedPrUrls.has(pr.url) ? " auto-watched-new" : "";

  return `
    <div class="pr-card${isAttention ? " attention" : ""}${autoWatchedClass}" data-url="${pr.url}" data-title="${pr.title.replace(/"/g, "&quot;")}">
      <div class="pr-status ${status.class}" title="${statusTitle}">${status.label}</div>
      <div class="pr-info">
        <div class="pr-title">${pr.title}</div>
        <div class="pr-meta">
          ${showAuthorInCards ? `<span class="pr-author-label">@${pr.author.login}</span><span class="meta-sep">·</span>` : ""}
          ${!groupByRepository ? `<span class="pr-repo-label">${pr.repository.name}</span><span class="meta-sep">·</span>` : ""}
          ${prNumber ? `<span class="pr-number">${prNumber}</span>` : ""}
        </div>
        <div class="pr-status-line">${statusParts.join('<span class="status-sep"> · </span>')}</div>
      </div>
      <button class="copy-btn" title="Copy PR URL (or press 'c')" aria-label="Copy PR URL"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="7" height="7" rx="1"/><rect x="7" y="7" width="7" height="7" rx="1"/></svg></button>
    </div>
  `;
}

// ── Action buttons ────────────────────────────────────────────────────────────

export function renderActionButtons(type: "org" | "repo", key: string): string {
  const favSet = type === "org" ? favoriteOrgs : favoriteRepos;
  const hideSet = type === "org" ? hiddenOrgs : hiddenRepos;
  const isFav = favSet.has(key);
  const isHidden = hideSet.has(key);
  const scope = type === "org" ? "organization" : "repository";
  const hideTitle = isHidden ? `Show ${scope}` : `Hide ${scope}`;
  const favTitle = isFav ? `Unfavorite ${scope}` : `Favorite ${scope}`;
  const ghUrl = `https://github.com/${key}`;
  const openTitle = `Open ${scope} on GitHub`;
  return `<button class="open-gh-btn" data-gh-url="${ghUrl}" title="${openTitle}" aria-label="${openTitle}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3H3v10h10v-3"/><path d="M9 2h5v5"/><path d="M14 2L7 9"/></svg></button><button class="hide-btn${isHidden ? " active" : ""}" data-hide-type="${type}" data-hide-key="${key}" title="${hideTitle}" aria-label="${hideTitle}"></button><button class="fav-btn${isFav ? " active" : ""}" data-fav-type="${type}" data-fav-key="${key}" title="${favTitle}" aria-label="${favTitle}">${isFav ? "★" : "☆"}</button>`;
}

// ── Accordion rendering ───────────────────────────────────────────────────────

export function renderRepoAccordion(
  org: string,
  repo: string,
  prs: PullRequest[],
  isHidden: boolean,
  forceExpand = false,
  minimal = false
): string {
  const repoKey = `${org}/${repo}`;
  const repoId = `repo:${repoKey}`;
  const isCollapsed = !forceExpand && collapsedAccordions.has(repoId);
  const repoOpen = isCollapsed ? "" : " open";
  const cls = isHidden ? " hidden-accordion" : "";
  let html = `<details class="accordion repo-accordion${cls}" data-accordion-id="${repoId}"${repoOpen}>`;
  html += `<summary class="accordion-header repo-header"><span class="accordion-chevron"></span><span class="accordion-label">${repo}</span><span class="accordion-count">${prs.length}</span>${renderActionButtons("repo", repoKey)}</summary>`;
  if (!isHidden) {
    html += prs.map((pr) => renderPrCard(pr, minimal)).join("");
  }
  html += `</details>`;
  return html;
}

export function renderAccordionContent(prs: PullRequest[], forceExpand = false, minimal = false): string {
  const grouped = groupPrs(prs);
  const renderedOrgs = new Set<string>();
  let html = "";

  const hasHidden = hiddenOrgs.size > 0 || hiddenRepos.size > 0 || pendingUnhideOrgs.size > 0 || pendingUnhideRepos.size > 0;
  if (prs.length === 0 && !hasHidden) {
    return "";
  }

  for (const [org, repos] of grouped) {
    renderedOrgs.add(org);
    const orgId = `org:${org}`;
    const isCollapsed = !forceExpand && collapsedAccordions.has(orgId);
    const orgOpen = isCollapsed ? "" : " open";
    const orgIsHidden = hiddenOrgs.has(org);
    const cls = orgIsHidden ? " hidden-accordion" : "";
    html += `<details class="accordion org-accordion${cls}" data-accordion-id="${orgId}"${orgOpen}>`;
    html += `<summary class="accordion-header org-header"><span class="accordion-chevron"></span><span class="accordion-label">${org}</span>${renderActionButtons("org", org)}</summary>`;

    if (!orgIsHidden) {
      const renderedRepos = new Set<string>();
      for (const [repo, repoPrs] of repos) {
        renderedRepos.add(`${org}/${repo}`);
        html += renderRepoAccordion(org, repo, repoPrs, hiddenRepos.has(`${org}/${repo}`), forceExpand, minimal);
      }

      if (!forceExpand) {
        for (const repoKey of hiddenRepos) {
          if (renderedRepos.has(repoKey)) continue;
          const [rOrg, rRepo] = repoKey.split("/");
          if (rOrg !== org) continue;
          html += renderRepoAccordion(org, rRepo, [], true, false, minimal);
        }
        for (const repoKey of pendingUnhideRepos) {
          if (renderedRepos.has(repoKey)) continue;
          const [rOrg, rRepo] = repoKey.split("/");
          if (rOrg !== org) continue;
          html += renderRepoAccordion(org, rRepo, [], false, false, minimal);
        }
      }
    }

    html += `</details>`;
  }

  if (!forceExpand) {
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
  }

  return html;
}

// ── Grouping ──────────────────────────────────────────────────────────────────

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
    return [org, sortedRepos] as [string, [string, PullRequest[]][]];
  });
}

// ── Flat list ─────────────────────────────────────────────────────────────────

export function renderFlatList(prs: PullRequest[], minimal = false): string {
  if (prs.length === 0) return "";
  const sorted = [...prs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return sorted.map((pr) => renderPrCard(pr, minimal)).join("");
}

// ── Collapsible Section (for merged tab) ───────────────────────────────────────

export function renderCollapsibleSection(sectionId: string, title: string, prs: PullRequest[]): string {
  if (prs.length === 0) return "";
  const body = groupByRepository ? renderAccordionContent(prs) : renderFlatList(prs);
  if (!body) return "";
  const isCollapsed = collapsedAccordions.has(sectionId);
  const sectionOpen = isCollapsed ? "" : " open";
  return `
    <details class="section-accordion" data-accordion-id="${sectionId}"${sectionOpen}>
      <summary class="section-header">
        <span class="accordion-chevron"></span>
        <span class="section-title">${title}</span>
      </summary>
      ${body}
    </details>
  `;
}
