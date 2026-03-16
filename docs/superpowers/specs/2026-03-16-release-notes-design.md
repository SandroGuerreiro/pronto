# Release Notes Feature — Design Spec

**Issue:** [#7 — Show release notes by clicking the version in the footer](https://github.com/SandroGuerreiro/pronto/issues/7)
**Date:** 2026-03-16

## Overview

Clicking the version text (`v0.7.0`) in the panel footer opens an inline release notes view showing the last 5 GitHub releases. The view follows the same content-replacement pattern as Settings. A "View on GitHub" link opens the full releases page in the default browser.

## Data Layer (Rust)

### New struct in `github.rs`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Release {
    pub tag_name: String,
    pub name: String,
    pub body: String,
    pub published_at: String,
    pub html_url: String,
}
```

### New field on `AppState` in `lib.rs`

```rust
pub cached_releases: Mutex<Option<Vec<Release>>>,
```

Added to the existing `AppState` struct (same pattern as `cached_prs`, `last_brew_status`, etc.).

### New Tauri command in `lib.rs`

```rust
#[tauri::command]
fn fetch_releases(app: tauri::AppHandle) -> Vec<Release> { ... }
```

Accesses state via `app.state::<AppState>()` — same signature pattern as all other commands.

- **Source:** GitHub REST API `GET /repos/SandroGuerreiro/pronto/releases?per_page=5`
- **Auth:** None required (public repo). Optionally pass token if available for higher rate limits.
- **Caching:** Fetched once at startup, stored in `AppState.cached_releases`
- **Fallback:** If the fetch fails (no network), return an empty vec; the frontend shows a graceful empty state

### Startup flow

In the Tauri setup hook (where polling is initialized), spawn a one-shot async task:
1. Call `GET /repos/SandroGuerreiro/pronto/releases?per_page=5`
2. Deserialize response into `Vec<Release>`
3. Store in managed state

## Frontend Module (`src/release-notes.ts`)

### Exports

| Function | Purpose |
|----------|---------|
| `initReleaseNotes(onCloseFn)` | Callback injection (same pattern as `initSettings`) |
| `showReleaseNotes()` | Replaces `#content` with release notes view |
| `hideReleaseNotes()` | Calls injected callback to restore PR view |

### View structure

```
┌──────────────────────────────────┐
│  ← Back          Release Notes  │  ← header bar
├──────────────────────────────────┤
│  ┌────────────────────────────┐  │
│  │ v0.7.0  [Latest]  Mar 11  │  │  ← blue left border, focused state
│  │ • Thread reply notifs      │  │
│  │ • UI animations            │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ v0.6.95          Mar 9    │  │  ← gray left border
│  │ • Bug fixes                │  │
│  └────────────────────────────┘  │
│  ... (up to 5 releases)         │
├──────────────────────────────────┤
│   View all releases on GitHub ↗  │  ← footer link
└──────────────────────────────────┘
```

### Keyboard navigation

| Key | Action |
|-----|--------|
| `j` / `↓` | Move focus to next release card |
| `k` / `↑` | Move focus to previous release card |
| `Enter` | Open focused release's `html_url` in browser |
| `Esc` | Close release notes, return to PR view |

Focus state tracked via `releaseNotesIndex` in `state.ts` (with `setReleaseNotesIndex` setter), reset to 0 when view opens.

### View state tracking

A boolean `releaseNotesOpen` is added to `state.ts` (with `setReleaseNotesOpen` setter). The keyboard handler in `main.ts` checks this boolean to route keys to release notes navigation vs. normal PR navigation — same approach as the settings view check (`activeTab === "settings"`).

### Empty state

If no releases are available (fetch failed or empty), show a centered message:
> "No release notes available"
> with a "View on GitHub ↗" link as fallback.

## Footer Version Text Styling

**`.version-text` changes:**
- `cursor: pointer` on hover
- Hover: `background: rgba(255, 255, 255, 0.06)`, `color: var(--text-secondary)`, `padding: 2px 8px`, `border-radius: 4px`
- Transition: `all 150ms ease`

## Wiring (`main.ts`)

1. Import `initReleaseNotes`, `showReleaseNotes`, `hideReleaseNotes`
2. Call `initReleaseNotes(() => renderActiveTab())` during boot
3. Add click handler on `#version-text` to call `showReleaseNotes()`
4. Add keyboard handler: when release notes view is active, route `j/k/Enter/Esc` to release notes navigation
5. `Esc` in release notes calls `hideReleaseNotes()` (same as settings)

## CSS (`styles.css`)

New section: `RELEASE NOTES` (after SETTINGS section)

- `.release-notes-view` — container (similar to `.settings-view` but no sidebar)
- `.release-notes-header` — flex row with back button and title
- `.release-card` — individual release entry with left border accent
- `.release-card.latest` — blue accent border + subtle blue background
- `.release-card.focused` — keyboard focus highlight (border color change)
- `.release-notes-footer` — centered "View on GitHub" link
- `.version-text` hover state additions

## TypeScript Types (`types.ts`)

```typescript
export interface Release {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
}
```

Exported from `types.ts` alongside other shared interfaces (`HomebrewStatus`, `WorkflowStatus`, etc.).

## Testing Strategy

### Unit tests (frontend)
- `showReleaseNotes()` renders correct number of release cards
- Keyboard nav updates focus index correctly (j/k wrapping)
- `Enter` triggers browser open with correct URL
- Empty state renders when no releases
- `hideReleaseNotes()` calls the injected callback

### Integration tests (Rust)
- `fetch_releases` command returns cached data
- Startup fetch populates managed state
- Empty cache returns empty vec gracefully

### E2E
- Click version → release notes view appears
- Navigate with j/k → focus moves between cards
- Press Esc → returns to PR view
- "View on GitHub" link opens browser

## Scope Exclusions

- No markdown rendering of release bodies (newlines converted to `<br>` for readability, but no full markdown parsing)
- No release notes refresh/polling (fetch once at startup only)
- No release notes for private repos (public API only)
