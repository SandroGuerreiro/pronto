# pronto

A macOS menu bar app that monitors your GitHub Pull Requests and notifies you when they need attention.

Built with [Tauri](https://tauri.app) (Rust) and Vanilla TypeScript.

## Features

- **Tray icon widget** -- lives in your menu bar, not the dock
- **Open PRs at a glance** -- see title, repo, review status, comments, and CI checks
- **Recently merged** -- shows PRs merged in the last 24 hours, separated from open ones
- **Needs attention notifications** -- tray icon badge + native macOS notification when a PR's status changes (new reviews, comments, CI failures, etc.)
- **Dismiss on hover** -- hovering over a highlighted PR card acknowledges it; once all are dismissed, the tray badge clears
- **1-minute polling** -- automatically refreshes in the background
- **Manual refresh** -- press `Cmd+Shift+P` anywhere to trigger an immediate re-poll
- **Clickable PR cards** -- opens the GitHub PR page in your browser
- **Two auth methods** -- GitHub OAuth (Device Flow) or Personal Access Token
- **Secure storage** -- tokens are stored in the macOS Keychain

## Screenshots

| Tray icon | PR list popup |
| --- | --- |
| Lives in the menu bar with a red badge when PRs need attention | Dark-themed popup showing open and recently merged PRs |

## Install

### Homebrew (recommended)

```bash
brew tap SandroGuerreiro/tap
brew install --cask pronto
```

### DMG

Download the latest `.dmg` from [GitHub Releases](https://github.com/SandroGuerreiro/pronto/releases), open it, and drag `pronto.app` to your Applications folder.

> **Note:** The app is not code-signed. On first launch, macOS will block it. Right-click the app and select **Open**, then click **Open** in the dialog to allow it.

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
| Fine-grained | **Repository access:** All repositories (or select specific ones). **Permissions:** Pull requests (read), Commit statuses (read), Checks (read) |

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
│   ├── main.ts             # UI logic: PR rendering, auth flow, event listeners
│   └── styles.css          # Popup styling
├── index.html              # Popup HTML shell
├── public/
│   └── logo.png            # Horizontal logo used in the popup header
├── src-tauri/              # Backend (Rust)
│   ├── src/
│   │   ├── main.rs         # Entry point (calls lib::run)
│   │   ├── lib.rs          # Tauri setup, commands, background polling
│   │   ├── github.rs       # GraphQL API client, PR structs, fetch logic
│   │   ├── tray.rs         # Tray icon setup, badge rendering, attention logic
│   │   └── auth.rs         # OAuth Device Flow, PAT validation, Keychain storage
│   ├── icons/              # App bundle icons + tray icon
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # Tauri configuration
├── package.json
└── LICENSE                 # PolyForm Noncommercial 1.0.0
```

## How it works

1. **Startup** -- The app registers as a macOS menu bar accessory (no dock icon), sets up the tray icon, and starts a background polling task.
2. **GitHub GraphQL API** -- Fetches open PRs and recently merged PRs (last 24h) using `search` queries scoped to `author:@me`.
3. **Attention detection** -- Each PR gets a "fingerprint" (hash of review status, approvals, comments, CI state). When a fingerprint changes between polls, the PR is flagged as needing attention.
4. **Tray badge** -- A red dot is drawn on the tray icon when any PR needs attention.
5. **Native notifications** -- A single summarized notification is sent when new attention items appear.
6. **Dismissal** -- Hovering over a PR card for 500ms marks it as seen. When all are dismissed, the badge clears.

## Keyboard shortcut

| Shortcut | Action |
| --- | --- |
| `Cmd+Shift+P` | Manual re-poll of PR data |

## Tech stack

- **Tauri 2** -- Rust backend + native webview frontend
- **Rust** -- async runtime (Tokio), HTTP client (reqwest), image manipulation (image crate), Keychain access (keyring crate)
- **TypeScript** -- Vanilla TS with Vite as the build tool
- **GitHub GraphQL API** -- PR data, reviews, comments, CI checks

## License

[PolyForm Noncommercial License 1.0.0](LICENSE)

Copyright 2026 Sandro Guerreiro
