import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { Release } from "./types";
import {
  releaseNotesIndex,
  setReleaseNotesOpen,
  setReleaseNotesIndex,
} from "./state";

marked.setOptions({ async: false, breaks: true });

let _onClosed: () => void = () => {};
let _releases: Release[] = [];

export function initReleaseNotes(onCloseFn: () => void) {
  _onClosed = onCloseFn;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function renderBody(body: string): string {
  return DOMPurify.sanitize(marked.parse(body) as string);
}

export async function showReleaseNotes() {
  const content = document.getElementById("content")!;
  const releases = await invoke<Release[]>("fetch_releases");
  _releases = releases;

  setReleaseNotesOpen(true);
  setReleaseNotesIndex(0);

  if (releases.length === 0) {
    content.innerHTML = `
      <div class="release-notes-view">
        <div class="release-notes-header">
          <button class="release-notes-back">← Back</button>
          <span class="release-notes-title">Release Notes</span>
        </div>
        <div class="release-notes-empty">
          <p>No release notes available</p>
          <a class="release-notes-github-link" href="#">View on GitHub ↗</a>
        </div>
      </div>
    `;
    bindReleaseNotesEvents(content);
    return;
  }

  const cardsHtml = releases.map((r, i) => {
    const isLatest = i === 0;
    const isFocused = i === 0;
    const classes = [
      "release-card",
      isLatest ? "latest" : "",
      isFocused ? "focused" : "",
    ].filter(Boolean).join(" ");

    return `
      <div class="${classes}" data-index="${i}" role="option" aria-selected="${isFocused}">
        <div class="release-card-header">
          <span class="release-tag">${escapeHtml(r.tag_name)}</span>
          ${isLatest ? '<span class="release-latest-badge">Latest</span>' : ""}
          <span class="release-date">${formatDate(r.published_at)}</span>
        </div>
        <div class="release-body">${renderBody(r.body)}</div>
      </div>
    `;
  }).join("");

  content.innerHTML = `
    <div class="release-notes-view">
      <div class="release-notes-header">
        <button class="release-notes-back">← Back</button>
        <span class="release-notes-title">Release Notes</span>
      </div>
      <div class="release-notes-list" role="listbox" aria-label="Release notes">
        ${cardsHtml}
      </div>
      <div class="release-notes-footer">
        <a class="release-notes-github-link" href="#">View all releases on GitHub ↗</a>
      </div>
    </div>
  `;

  bindReleaseNotesEvents(content);
}

function bindReleaseNotesEvents(content: HTMLElement) {
  const backBtn = content.querySelector(".release-notes-back");
  backBtn?.addEventListener("click", () => hideReleaseNotes());

  const githubLink = content.querySelector(".release-notes-github-link");
  githubLink?.addEventListener("click", (e) => {
    e.preventDefault();
    openUrl("https://github.com/SandroGuerreiro/pronto/releases");
  });
}

export function hideReleaseNotes() {
  setReleaseNotesOpen(false);
  _releases = [];
  _onClosed();
}

export function navigateReleaseNotes(delta: number) {
  if (_releases.length === 0) return;

  const newIndex = Math.max(0, Math.min(_releases.length - 1, releaseNotesIndex + delta));
  setReleaseNotesIndex(newIndex);

  const cards = document.querySelectorAll(".release-card");
  cards.forEach((card, i) => {
    const isFocused = i === newIndex;
    card.classList.toggle("focused", isFocused);
    card.setAttribute("aria-selected", String(isFocused));
  });

  const target = cards[newIndex] as HTMLElement | undefined;
  if (target && typeof target.scrollIntoView === "function") {
    target.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

export function openFocusedRelease() {
  if (_releases.length === 0) return;
  const release = _releases[releaseNotesIndex];
  if (release) {
    openUrl(release.html_url);
  }
}
