/**
 * Dev-only states preview panel.
 * Renders mock PR cards in every visual state to test animations and styling.
 * Loaded dynamically behind `import.meta.env.DEV` — never bundled in production.
 */

const sep = '<span class="status-sep"> · </span>';
const commentIcon = '<svg class="comment-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2v2.543L9.06 10.5h4.19a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>';

function mockCard(opts: {
  title: string;
  statusLabel: string;
  statusClass: string;
  cardClasses?: string;
  statusLine: string;
  repo?: string;
  number?: string;
  author?: string;
}): string {
  const repo = opts.repo || "acme/widget";
  const num = opts.number || "#42";
  const author = opts.author ? `<span class="pr-author-label">@${opts.author}</span><span class="meta-sep">·</span>` : "";
  return `
    <div class="pr-card${opts.cardClasses ? " " + opts.cardClasses : ""}" data-url="#" data-title="${opts.title}">
      <div class="pr-status ${opts.statusClass}">${opts.statusLabel}</div>
      <div class="pr-info">
        <div class="pr-title">${opts.title}</div>
        <div class="pr-meta">
          ${author}
          <span class="pr-repo-label">${repo}</span><span class="meta-sep">·</span>
          <span class="pr-number">${num}</span>
        </div>
        <div class="pr-status-line">${opts.statusLine}</div>
      </div>
    </div>
  `;
}

const replayBtnStyle = 'background:none;border:1px solid rgba(255,255,255,0.08);color:#71717a;font-size:10px;padding:2px 8px;border-radius:4px;cursor:pointer;margin-left:auto;';

function section(id: string, title: string, body: string, opts: { exitDemo?: boolean; replayable?: boolean } = {}): string {
  const showReplay = opts.exitDemo || opts.replayable;
  const replayBtn = showReplay ? `<button class="dev-replay-btn" data-replay="${id}" style="${replayBtnStyle}">replay</button>` : "";
  return `
    <div class="dev-section${opts.exitDemo ? " dev-exit-demo" : ""}" data-section-id="${id}" style="margin-bottom: 4px;">
      <div style="font-size: 10px; font-weight: 600; color: #71717a; text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 4px 4px; border-top: 1px solid rgba(255,255,255,0.06); display: flex; align-items: center;">
        ${title}
        ${replayBtn}
      </div>
      <div class="dev-section-body">${body}</div>
    </div>
  `;
}

function replaySection(container: HTMLElement, sectionId: string) {
  const sectionEl = container.querySelector<HTMLElement>(`.dev-section[data-section-id="${sectionId}"]`);
  if (!sectionEl) return;
  const body = sectionEl.querySelector<HTMLElement>(".dev-section-body");
  if (!body) return;

  // For exit demo sections: add exit class → wait for animation → hide → wait → restore
  if (sectionEl.classList.contains("dev-exit-demo")) {
    const exitClass = sectionId; // e.g. "card-exit-merged"
    const card = body.querySelector<HTMLElement>(".pr-card");
    if (!card) return;
    // If already animating, ignore
    if (card.classList.contains(exitClass)) return;

    // Preserve height so the list doesn't jump
    const height = card.offsetHeight;
    card.classList.add(exitClass);
    setTimeout(() => {
      card.style.minHeight = `${height}px`;
      card.style.visibility = "hidden";
      card.classList.remove(exitClass);
      setTimeout(() => {
        card.style.minHeight = "";
        card.style.visibility = "";
        // Re-trigger card-slide-in
        card.style.animation = "none";
        void card.offsetHeight;
        card.style.animation = "";
      }, 1000);
    }, 400);
    return;
  }

  // Default: re-insert original HTML to restart CSS animations
  const original = body.getAttribute("data-original-html") ?? body.innerHTML;
  body.innerHTML = "";
  void body.offsetHeight;
  body.innerHTML = original;
}

export function renderDevStates(): string {
  let html = `
    <div style="padding: 2px 0 6px; font-size: 11px; color: #52525b; text-align: center; display: flex; align-items: center; justify-content: center; gap: 10px;">
      DEV STATES PREVIEW — press <kbd style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:3px;font-size:10px;">D</kbd> to close
      <button id="dev-replay-all" style="${replayBtnStyle}">replay all</button>
    </div>
  `;

  // ── Open states ──
  html += section("open-approved", "Open — Approved + Checks Passing", mockCard({
    title: "Add user onboarding flow",
    statusLabel: "●", statusClass: "open",
    statusLine: `<span class="approved">approved</span>${sep}<span class="checks-pass">checks passed</span>${sep}<span class="status-detail">☑ 3</span>${sep}<span class="status-detail">${commentIcon} 5</span>${sep}<span class="status-detail">▣ 2</span>`,
  }));

  html += section("open-needs-review", "Open — Needs Reviews + Checks Pending", mockCard({
    title: "Refactor authentication middleware",
    statusLabel: "●", statusClass: "open",
    statusLine: `<span class="needs-reviews">needs reviews</span>${sep}<span class="checks-pending">checks running</span>${sep}<span class="status-detail">☑ 0</span>${sep}<span class="status-detail">${commentIcon} 1</span>${sep}<span class="status-detail">▣ 0</span>`,
    repo: "acme/auth-service", number: "#108",
  }));

  html += section("open-changes", "Open — Changes Requested + Checks Failed", mockCard({
    title: "Fix race condition in payment processor",
    statusLabel: "●", statusClass: "open",
    statusLine: `<span class="changes-requested">changes requested</span>${sep}<span class="checks-fail">checks failed</span>${sep}<span class="status-detail">☑ 2</span>${sep}<span class="status-detail">${commentIcon} 8</span>${sep}<span class="status-detail">▣ 1</span>`,
    repo: "acme/payments", number: "#231",
  }));

  // ── Draft ──
  html += section("draft", "Draft PR", mockCard({
    title: "WIP: Explore new caching strategy",
    statusLabel: "●", statusClass: "draft",
    statusLine: `<span class="draft-label">draft</span>${sep}<span class="checks-pending">checks running</span>${sep}<span class="status-detail">☑ 0</span>${sep}<span class="status-detail">${commentIcon} 1</span>${sep}<span class="status-detail">▣ 0</span>`,
    repo: "acme/perf", number: "#64",
  }));

  // ── Attention states ──
  html += section("attention-new", "Attention — New Activity", mockCard({
    title: "Update caching layer for better performance",
    statusLabel: "●", statusClass: "open", cardClasses: "attention",
    statusLine: `<span class="approved">approved</span>${sep}<span class="checks-pass">checks passed</span>${sep}<span class="status-detail">☑ 2</span>${sep}<span class="status-detail highlight-attention">${commentIcon} 4</span>${sep}<span class="status-detail">▣ 1</span>`,
    repo: "acme/cache", number: "#77",
  }));

  html += section("attention-changed", "Attention — Review Changed + Checks Changed", mockCard({
    title: "Migrate database schema to v3",
    statusLabel: "●", statusClass: "open", cardClasses: "attention",
    statusLine: `<span class="changes-requested highlight-changed">changes requested</span>${sep}<span class="checks-fail highlight-changed">checks failed</span>${sep}<span class="status-detail">☑ 1</span>${sep}<span class="status-detail">${commentIcon} 3</span>${sep}<span class="status-detail">▣ 0</span>`,
    repo: "acme/db", number: "#15",
  }));

  // ── Auto-followed (issue #50) ──
  html += section("auto-followed", "Auto-followed — Newly Tracked", mockCard({
    title: "Refactor cache invalidation logic",
    statusLabel: "●", statusClass: "open", cardClasses: "auto-followed-new",
    statusLine: `<span class="needs-reviews">needs reviews</span>${sep}<span class="checks-pass">checks passed</span>${sep}<span class="status-detail">☑ 1</span>${sep}<span class="status-detail">${commentIcon} 3</span>${sep}<span class="status-detail">▣ 0</span>`,
    repo: "acme/cache", number: "#412", author: "teammate",
  }), { replayable: true });

  // ── In Queue ──
  html += section("in-queue", "In Merge Queue", mockCard({
    title: "Ship new dashboard redesign",
    statusLabel: "◎", statusClass: "in-queue",
    statusLine: `<span class="in-queue-text">in queue #2</span>${sep}<span class="status-detail">☑ 4</span>${sep}<span class="status-detail">${commentIcon} 12</span>${sep}<span class="status-detail">▣ 3</span>`,
    repo: "acme/frontend", number: "#500",
  }));

  // ── Merged ──
  html += section("merged", "Merged", mockCard({
    title: "Implement SSO integration",
    statusLabel: "✓", statusClass: "merged",
    statusLine: `<span class="approved">approved</span>${sep}<span class="checks-pass">checks passed</span>${sep}<span class="status-detail">☑ 3</span>${sep}<span class="status-detail">${commentIcon} 6</span>${sep}<span class="status-detail">▣ 4</span>`,
    repo: "acme/identity", number: "#92", author: "teammate",
  }));

  // ── Closed ──
  html += section("closed", "Closed (not merged)", mockCard({
    title: "Experimental: try new bundler [abandoned]",
    statusLabel: "✗", statusClass: "closed",
    statusLine: `<span class="needs-reviews">needs reviews</span>${sep}<span class="checks-none">no checks</span>${sep}<span class="status-detail">☑ 0</span>${sep}<span class="status-detail">${commentIcon} 2</span>${sep}<span class="status-detail">▣ 0</span>`,
    repo: "acme/tooling", number: "#33",
  }));

  // ── Exit animations (shown as normal cards, replay triggers exit → restore) ──
  html += section("card-exit-merged", "Exit Animation — Merged", mockCard({
    title: "This card is being merged right now",
    statusLabel: "●", statusClass: "open",
    statusLine: `<span class="approved">approved</span>${sep}<span class="checks-pass">checks passed</span>${sep}<span class="status-detail">☑ 2</span>${sep}<span class="status-detail">${commentIcon} 1</span>${sep}<span class="status-detail">▣ 0</span>`,
    repo: "acme/core", number: "#200",
  }), { exitDemo: true });

  html += section("card-exit-closed", "Exit Animation — Closed", mockCard({
    title: "This card is being closed right now",
    statusLabel: "●", statusClass: "open",
    statusLine: `<span class="needs-reviews">needs reviews</span>${sep}<span class="checks-none">no checks</span>${sep}<span class="status-detail">☑ 0</span>${sep}<span class="status-detail">${commentIcon} 0</span>${sep}<span class="status-detail">▣ 0</span>`,
    repo: "acme/experiment", number: "#7",
  }), { exitDemo: true });

  html += section("card-exit-hidden", "Exit Animation — Hidden", mockCard({
    title: "This card is being hidden right now",
    statusLabel: "●", statusClass: "open",
    statusLine: `<span class="approved">approved</span>${sep}<span class="checks-pass">checks passed</span>${sep}<span class="status-detail">☑ 1</span>${sep}<span class="status-detail">${commentIcon} 0</span>${sep}<span class="status-detail">▣ 0</span>`,
    repo: "acme/misc", number: "#55",
  }), { exitDemo: true });

  // ── Misc elements ──
  html += section("badges", "Tab Badge Pulse", `
    <div style="display: flex; gap: 12px; align-items: center; padding: 8px;">
      <span class="tab-badge">3</span>
      <span class="tab-badge">12</span>
      <span style="font-size: 11px; color: #52525b;">(badges pulse when present)</span>
    </div>
  `);

  html += section("version-shimmer", "Version — New Update Shimmer", `
    <div style="display: flex; gap: 12px; align-items: center; padding: 8px;">
      <span class="version-text version-new" style="cursor: pointer;">v0.7.0</span>
      <span style="font-size: 11px; color: #52525b;">(shimmer plays once, text stays brighter until hover)</span>
    </div>
  `, { replayable: true });

  html += section("notification-sound", "Notification Sounds", `
    <div style="display: flex; gap: 8px; padding: 8px; align-items: center; flex-wrap: wrap;">
      <button class="dev-play-sound" data-kind="attention" style="${replayBtnStyle} font-size: 11px; padding: 4px 12px;">▶ Purr</button>
      <button class="dev-play-sound" data-kind="checks_failed" style="${replayBtnStyle} font-size: 11px; padding: 4px 12px;">▶ Basso</button>
      <button class="dev-play-sound" data-kind="workflow_success" style="${replayBtnStyle} font-size: 11px; padding: 4px 12px;">▶ Funk</button>
      <span style="font-size: 11px; color: #52525b;">Attention / Checks failed / Workflow success</span>
    </div>
  `);

  html += section("notification-trigger", "Trigger Notification Banner", `
    <div style="display: flex; gap: 8px; padding: 8px; align-items: center; flex-wrap: wrap;">
      <button class="dev-trigger-notif" data-kind="attention" style="${replayBtnStyle} font-size: 11px; padding: 4px 12px;">PR attention</button>
      <button class="dev-trigger-notif" data-kind="workflow" style="${replayBtnStyle} font-size: 11px; padding: 4px 12px;">Workflow</button>
      <button class="dev-trigger-notif" data-kind="error" style="${replayBtnStyle} font-size: 11px; padding: 4px 12px;">Error</button>
      <button class="dev-trigger-notif" data-kind="brew_update" style="${replayBtnStyle} font-size: 11px; padding: 4px 12px;">Update</button>
      <button class="dev-trigger-notif" data-kind="follow" style="${replayBtnStyle} font-size: 11px; padding: 4px 12px;">Follow</button>
    </div>
  `);

  html += section("workflows", "Workflow Indicators", `
    <div style="display: flex; gap: 8px; padding: 8px; flex-wrap: wrap;">
      <span class="workflow-indicator wf-success"><span class="wf-dot"></span><span class="wf-label">Success</span></span>
      <span class="workflow-indicator wf-failure"><span class="wf-dot"></span><span class="wf-label">Failure</span></span>
      <span class="workflow-indicator wf-failure wf-attention"><span class="wf-dot"></span><span class="wf-label">Failure (attention)</span></span>
      <span class="workflow-indicator wf-other"><span class="wf-dot"></span><span class="wf-label">In Progress</span></span>
    </div>
  `);

  return html;
}

export function bindDevStateEvents(container: HTMLElement) {
  // Snapshot original HTML for each section body so replay restores pristine state
  container.querySelectorAll<HTMLElement>(".dev-section-body").forEach((body) => {
    body.setAttribute("data-original-html", body.innerHTML);
  });

  // Per-section replay buttons
  container.querySelectorAll<HTMLButtonElement>(".dev-replay-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-replay");
      if (id) replaySection(container, id);
    });
  });

  // Version shimmer: remove "version-new" on hover (matches real app behavior)
  const shimmerSection = container.querySelector<HTMLElement>('.dev-section[data-section-id="version-shimmer"]');
  if (shimmerSection) {
    shimmerSection.addEventListener("mouseenter", (e) => {
      const target = e.target as HTMLElement;
      if (target.classList?.contains("version-new")) {
        target.classList.remove("version-new");
      }
    }, true);
  }

  // Play notification sound buttons
  container.querySelectorAll<HTMLButtonElement>(".dev-play-sound").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const kind = btn.getAttribute("data-kind") ?? "attention";
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("play_sound", { kind });
    });
  });

  // Trigger notification banner buttons (dev only)
  container.querySelectorAll<HTMLButtonElement>(".dev-trigger-notif").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const kind = btn.getAttribute("data-kind") ?? "attention";
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("dev_trigger_notification", { kind });
    });
  });

  // Replay all button
  const replayAllBtn = container.querySelector<HTMLButtonElement>("#dev-replay-all");
  if (replayAllBtn) {
    replayAllBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      container.querySelectorAll<HTMLElement>(".dev-section").forEach((sec) => {
        const id = sec.getAttribute("data-section-id");
        if (id) replaySection(container, id);
      });
    });
  }
}
