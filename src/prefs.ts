import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "./types";
import {
  favoriteOrgs,
  favoriteRepos,
  collapsedAccordions,
  hiddenOrgs,
  hiddenRepos,
  hiddenPrs,
  watchedPrs,
  setGroupByRepository,
  setWatchedUsers,
  activeWatchFilter,
  setActiveWatchFilter,
} from "./state";

// Injected callbacks (wired in main.ts)
let _onRender: () => void = () => {};
let _onReload: () => void = () => {};

export function initPrefs(onRender: () => void, onReload: () => void) {
  _onRender = onRender;
  _onReload = onReload;
}

// ── Load ──────────────────────────────────────────────────────────────────────

export async function loadUserPrefs() {
  const s = await invoke<Settings>("get_settings");
  favoriteOrgs.clear();
  s.favorite_orgs.forEach((o) => favoriteOrgs.add(o));
  favoriteRepos.clear();
  s.favorite_repos.forEach((r) => favoriteRepos.add(r));
  collapsedAccordions.clear();
  s.collapsed_accordions.forEach((a) => collapsedAccordions.add(a));
  hiddenOrgs.clear();
  s.hidden_orgs.forEach((o) => hiddenOrgs.add(o));
  hiddenRepos.clear();
  s.hidden_repos.forEach((r) => hiddenRepos.add(r));
  hiddenPrs.clear();
  (s.hidden_prs || []).forEach((h) => hiddenPrs.set(h.url, h.title));
  watchedPrs.clear();
  (s.watched_prs || []).forEach((url) => watchedPrs.add(url));
  setGroupByRepository(s.group_by_repository !== false);
  const users = s.watched_users || [];
  setWatchedUsers(users);
  if (activeWatchFilter !== "all" && !users.includes(activeWatchFilter)) {
    setActiveWatchFilter("all");
  }
}

// ── Persist ───────────────────────────────────────────────────────────────────

let _savePending = false;

export function persistPrefs() {
  if (_savePending) return;
  _savePending = true;
  queueMicrotask(async () => {
    _savePending = false;
    const current = await invoke<Settings>("get_settings");
    current.favorite_orgs = [...favoriteOrgs];
    current.favorite_repos = [...favoriteRepos];
    current.collapsed_accordions = [...collapsedAccordions];
    current.hidden_orgs = [...hiddenOrgs];
    current.hidden_repos = [...hiddenRepos];
    current.hidden_prs = [...hiddenPrs.entries()].map(([url, title]) => ({ url, title }));
    current.watched_prs = [...watchedPrs];
    await invoke("update_settings", { settings: current });
  });
}

// ── Favorites ─────────────────────────────────────────────────────────────────

export function toggleFavorite(type: "org" | "repo", key: string) {
  const set = type === "org" ? favoriteOrgs : favoriteRepos;
  if (set.has(key)) {
    set.delete(key);
  } else {
    set.add(key);
  }
  persistPrefs();
  _onRender();
}

// ── Hidden ────────────────────────────────────────────────────────────────────

export async function toggleHidden(type: "org" | "repo", key: string) {
  const set = type === "org" ? hiddenOrgs : hiddenRepos;
  if (set.has(key)) {
    set.delete(key);
  } else {
    set.add(key);
  }
  _onRender();
  const current = await invoke<Settings>("get_settings");
  current.favorite_orgs = [...favoriteOrgs];
  current.favorite_repos = [...favoriteRepos];
  current.collapsed_accordions = [...collapsedAccordions];
  current.hidden_orgs = [...hiddenOrgs];
  current.hidden_repos = [...hiddenRepos];
  await invoke("update_settings", { settings: current });
  _onReload();
}
