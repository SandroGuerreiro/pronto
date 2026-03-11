# pronto

A macOS menu bar app that monitors your GitHub Pull Requests and notifies you when they need attention.

Built with [Tauri](https://tauri.app) (Rust) and Vanilla TypeScript.

## Features

- **Tray icon widget** -- lives in your menu bar, not the dock
- **Open PRs at a glance** -- see title, repo, review status, comments, and CI checks
- **Recently merged** -- shows PRs merged in a configurable time window (12h / 24h / 48h), in a separate tab
- **Recently closed** -- shows unmerged closed PRs in a configurable time window (12h / 24h / 48h), disabled by default
- **Needs attention notifications** -- tray icon badge + native macOS notification when a PR's status changes (reviews, comments, CI, merge queue transitions); per-category notification preferences configurable per event type; followed PRs notify when owned threads are replied to; own PR notifications active by default
- **Notification actions** -- notification title is the PR name, body describes what changed; clicking the notification opens the PR and clears its attention status
- **Dismiss on hover** -- hovering over a highlighted PR card for ~800ms acknowledges it; once all are dismissed, the tray badge clears
- **Tab attention badges** -- the Open and Recently Merged tabs show a count of PRs needing attention
- **Organized by org & repo** -- PRs are grouped into nested accordions (organization > repository), or displayed as a flat date-sorted list (configurable)
- **Favorites** -- star organizations and repositories to pin them to the top of the list
- **Hide orgs & repos** -- hide organizations or repositories so they stop being fetched; hidden items remain visible (greyed out) for easy unhiding
- **Hide individual PRs** -- press `i` on a focused PR to hide it; unhide from the settings blacklist
- **Workflow monitor** -- track the status of a GitHub Actions workflow in the header; triggers attention when the status changes between success and failure
- **Configurable polling** -- 1 / 2 / 5 / 10 minute intervals
- **Follow PRs from anywhere** -- copy a PR URL, press the global follow shortcut, and it's added to your followed list without leaving your current app
- **Global shortcuts** -- toggle the popup, reload, or follow a PR from anywhere on your Mac
- **Full keyboard navigation** -- browse PRs, expand/collapse accordions, switch tabs, and dismiss attention without touching the mouse
- **Settings search** -- quickly filter settings with a search bar
- **Two auth methods** -- GitHub OAuth (Device Flow) or Personal Access Token
- **Secure storage** -- tokens are stored in the macOS Keychain
- **Persistent state** -- accordion states, favorites, hidden items, and all settings survive app restarts

## Screenshots

| Tray icon | PR list popup |
| --- | --- |
| Lives in the menu bar with a red badge when PRs need attention | Dark-themed popup showing open and recently merged PRs |

## Install

### Homebrew (recommended)

```bash
brew install --cask SandroGuerreiro/tap/pronto
```

To update:

```bash
brew update && brew upgrade --cask pronto
```

### DMG

Download the latest `.dmg` from [GitHub Releases](https://github.com/SandroGuerreiro/pronto/releases), open it, and drag `Pronto.app` to your Applications folder.

> **Note:** The app is not code-signed. macOS may show "Pronto is damaged and can't be opened." To fix this, run:
>
> ```bash
> xattr -cr /Applications/Pronto.app
> ```

## Authentication

On first launch, pronto shows a login screen with two options:

### Option 1: Sign in with GitHub (OAuth)

1. Click **Sign in with GitHub**
2. A one-time code is displayed -- click it to copy
3. Open the GitHub verification link in your browser
4. Paste the code and authorize the app
5. pronto detects authorization automatically and loads your PRs

This uses the OAuth Device Flow with the `repo` scope.

### Option 2: Personal Access Token

1. Click **Use Personal Access Token**
2. Create a token at [github.com/settings/tokens](https://github.com/settings/tokens)
3. Paste it into the input field and click **Connect**

**Required permissions:**

| Token type | Scopes |
| --- | --- |
| Classic | `repo` (full control of private repositories) |
| Fine-grained | **Repository access:** All repositories (or select specific ones). **Permissions:** Contents (read), Metadata (read), Pull requests (read) |

## Keyboard shortcuts

### Global (work from any app)

| Shortcut | Action |
| --- | --- |
| `Cmd+Ctrl+P` | Toggle the popup open / closed |
| `Cmd+Ctrl+R` | Manually reload PR data |
| `Super+Ctrl+L` | Follow/unfollow PR from clipboard URL |

### Inside the popup

| Key | Action |
| --- | --- |
| `j` / `↓` | Move focus down |
| `k` / `↑` | Move focus up |
| `l` / `→` | Expand focused accordion |
| `h` / `←` | Collapse focused accordion |
| `Enter` | Open focused PR in browser / toggle accordion |
| `i` | Hide focused PR (add to blacklist) |
| `1` | Switch to Owned tab |
| `2` | Switch to Followed tab |
| `3` | Switch to Recently Merged tab |
| `4` | Switch to Recently Closed tab |
| `Tab` | Switch between tabs |
| `Escape` | Close settings if open, otherwise close popup |

Focusing a PR card that needs attention will dismiss its attention status after ~800ms, the same as hovering with the mouse.

## Settings

Open settings from the gear icon in the header. Settings are organized into searchable sections:

- **General** -- Polling interval
- **Notifications** -- Per-category notification preferences (Owned, Followed, Merged, Closed). Per-category event toggles: needs review, changes requested, checks failed, new reviews, threads updated, merge queue
- **Display** -- Group by repository (accordions vs flat list), show recently merged toggle with time window, show recently closed toggle with time window
- **Workflow** -- Monitor a single GitHub Actions workflow; configure the organization, repository, and workflow filename (e.g. `deploy.yml`). Only terminal states (success / failure) are tracked.
- **Keys** -- Customize keyboard shortcuts for in-app navigation, tab switching, and global toggles/reload
- **Users** -- Manage followed users, followed PRs, and view the PR hide blacklist

## Development

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/installation)
- Xcode Command Line Tools (`xcode-select --install`)

### Setup

```bash
git clone https://github.com/SandroGuerreiro/pronto.git
cd pronto
pnpm install
```

### Run in development

```bash
pnpm tauri dev
```

This starts the Vite dev server and launches the Tauri app with hot-reload.

### Build for production

```bash
pnpm tauri build --bundles dmg
```

The built `.dmg` will be at `src-tauri/target/release/bundle/dmg/`.

## Project structure

```
pronto/
├── src/                    # Frontend (TypeScript + HTML + CSS)
│   ├── main.ts             # Entry point: PR list initialization, keyboard nav
│   ├── types.ts            # TypeScript interfaces and enums
│   ├── state.ts            # Global mutable state management
│   ├── renderer.ts         # PR card and accordion rendering
│   ├── prefs.ts            # User preferences and favorites
│   ├── tabs.ts             # Tab switching and content rendering
│   ├── settings.ts         # Settings modal UI
│   ├── auth.ts             # Login and authentication UI
│   └── styles.css          # All popup styling
├── index.html              # Popup HTML shell
├── public/
│   └── logo.png            # Horizontal logo used in the popup header
├── src-tauri/              # Backend (Rust)
│   ├── src/
│   │   ├── main.rs         # Entry point (calls lib::run)
│   │   ├── lib.rs          # Tauri setup, commands, polling, workflow monitor
│   │   ├── github.rs       # GraphQL + REST API client, PR & workflow structs
│   │   ├── tray.rs         # Tray icon setup, badge rendering, attention logic
│   │   └── auth.rs         # OAuth Device Flow, PAT validation, Keychain storage
│   ├── icons/              # App bundle icons + tray icon
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # Tauri configuration
├── package.json
└── LICENSE                 # PolyForm Noncommercial 1.0.0
```

## How it works

1. **Startup** -- The app registers as a macOS menu bar accessory (no dock icon), sets up the tray icon, registers global shortcuts, and starts a background polling task.
2. **GitHub GraphQL API** -- Fetches open PRs, recently merged PRs, and recently closed PRs (if enabled) using `search` queries scoped to `author:@me`. Hidden orgs, repos, and individual PRs are excluded from the query.
3. **GitHub REST API** -- If workflow monitoring is enabled, fetches the latest completed runs for the configured workflow and picks the most recent success or failure.
4. **Attention detection** -- Each PR gets a "fingerprint" (hash of review status, approvals, comments, CI state, merge queue status). When a fingerprint changes between polls, the PR is flagged as needing attention. Workflow status changes also trigger attention.
5. **Tray badge** -- A red dot is drawn on the tray icon when any PR (or the workflow) needs attention.
6. **Native notifications** -- Per-PR notifications with the PR title and a description of what changed. Clicking the notification opens the PR and clears its attention status.
7. **Dismissal** -- Hovering over or focusing (via keyboard) a PR card for ~800ms marks it as seen. When all are dismissed, the badge clears.

## Tech stack

- **Tauri 2** -- Rust backend + native webview frontend
- **Rust** -- async runtime (Tokio), HTTP client (reqwest), image manipulation (image crate), Keychain access (keyring crate), native notifications (mac-notification-sys)
- **TypeScript** -- Vanilla TS with Vite as the build tool
- **GitHub GraphQL API** -- PR data, reviews, comments, CI checks
- **GitHub REST API** -- Actions workflow run status

## License

[PolyForm Noncommercial License 1.0.0](LICENSE)

Copyright 2026 Sandro Guerreiro
