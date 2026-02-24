import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";

interface Reviews {
  totalCount: number;
}

interface MergeQueueEntry {
  position: number;
}

interface Repository {
  name: string;
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
      return { reviewText, statusText: null, statusClass: "approved" };
    case "CHANGES_REQUESTED":
      return { reviewText, statusText: "changes requested", statusClass: "changes-requested" };
    case "REVIEW_REQUIRED":
      return { reviewText, statusText: "needs reviews", statusClass: "needs-reviews" };
    default:
      return { reviewText, statusText: null, statusClass: "" };
  }
}

let currentAttentionUrls: string[] = [];

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
          <span class="pr-repo">${pr.repository.name}</span>
          <span>·</span>
          <span class="pr-reviews">${reviewText}</span>
          <span>·</span>
          <span class="pr-comments">🗨 ${pr.comments.totalCount + pr.reviewThreads.nodes.filter(t => !t.isResolved).length}</span>
          <span class="pr-resolved">▣ ${pr.reviewThreads.nodes.filter(t => t.isResolved).length}</span>
        </div>
        <div class="pr-status-line">${statusParts.join('<span class="status-sep"> · </span>')}</div>
      </div>
    </div>
  `;
}

function renderContent(result: FetchResult): string {
  if (result.open.length === 0 && result.recently_merged.length === 0) {
    return '<div class="empty">No open PRs</div>';
  }

  let html = "";

  if (result.open.length > 0) {
    html += '<div class="section-label">Open</div>';
    html += result.open.map(renderPrCard).join("");
  }

  if (result.recently_merged.length > 0) {
    if (result.open.length > 0) {
      html += '<div class="divider"></div>';
    }
    html += '<div class="section-label">Recently Merged</div>';
    html += result.recently_merged.map(renderPrCard).join("");
  }

  return html;
}

async function loadPrs() {
  const content = document.getElementById("content")!;

  try {
    const result = await invoke<FetchResult>("fetch_prs");
    currentAttentionUrls = result.attention_urls;
    content.innerHTML = renderContent(result);

    content.querySelectorAll(".pr-card").forEach((card) => {
      card.addEventListener("click", () => {
        const url = card.getAttribute("data-url");
        if (url) openUrl(url);
      });

      card.addEventListener("mouseenter", () => {
        if (card.classList.contains("attention")) {
          card.classList.remove("attention");
          const url = card.getAttribute("data-url");
          if (url) invoke("dismiss_pr", { url });
        }
      });
    });
  } catch (e) {
    content.innerHTML = `<div class="empty">Failed to load PRs</div>`;
    console.error(e);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  loadPrs();

  listen("prs-updated", () => {
    loadPrs();
  });

  document.getElementById("quit-btn")?.addEventListener("click", async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().hide();
  });
});
