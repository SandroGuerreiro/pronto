import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DeviceCodeResponse } from "./types";
import { setIsAuthenticated } from "./state";

// Injected callback: called on successful login (wired in main.ts)
let _onLoginSuccess: () => void = () => {};

export function initAuth(onSuccess: () => void) {
  _onLoginSuccess = onSuccess;
}

// ── Login view ────────────────────────────────────────────────────────────────

export function showLogin() {
  setIsAuthenticated(false);
  const content = document.getElementById("content")!;
  document.getElementById("signout-btn")!.style.display = "none";
  document.getElementById("main-nav")!.style.display = "none";

  content.innerHTML = `
    <div class="login-view">
      <div class="login-icon">🔑</div>
      <div class="login-title">Connect to GitHub</div>
      <div class="login-desc">Sign in to see your PRs.</div>
      <button id="login-btn" class="login-btn">Sign in with GitHub</button>
      <button id="pat-btn" class="login-btn login-btn-secondary">Use Personal Access Token</button>
      <button id="login-quit-btn" class="login-quit-btn">Quit</button>
    </div>
  `;

  document.getElementById("login-btn")!.addEventListener("click", startLogin);
  document.getElementById("pat-btn")!.addEventListener("click", showPatInput);
  document.getElementById("login-quit-btn")!.addEventListener("click", async () => {
    const { exit } = await import("@tauri-apps/plugin-process");
    await exit(0);
  });
}

// ── PAT input view ────────────────────────────────────────────────────────────

export function showPatInput() {
  const content = document.getElementById("content")!;

  content.innerHTML = `
    <div class="login-view">
      <div class="login-title">Personal Access Token</div>
      <div class="login-desc">Paste a token with the right permissions. <a id="perm-info-link" href="#" class="login-link">What permissions do I need?</a></div>
      <input id="pat-input" type="password" class="pat-input" placeholder="ghp_xxxxxxxxxxxx" autocomplete="off" spellcheck="false" autocapitalize="off" autocorrect="off" />
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
      _onLoginSuccess();
    } catch {
      error.textContent = "Invalid token. Please check and try again.";
      btn.disabled = false;
      btn.textContent = "Connect";
    }
  });

  document.getElementById("pat-input")!.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      (document.getElementById("pat-connect-btn") as HTMLButtonElement).click();
    }
  });
}

// ── Permissions info view ─────────────────────────────────────────────────────

export function showPermissionsInfo() {
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

// ── OAuth device flow ─────────────────────────────────────────────────────────

export async function startLogin() {
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
        <button id="oauth-back-btn" class="login-btn login-btn-secondary">Back</button>
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
          _onLoginSuccess();
          return;
        }
      } catch {
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

    document.getElementById("oauth-back-btn")!.addEventListener("click", () => {
      clearInterval(poll);
      showLogin();
    });
  } catch {
    content.innerHTML = `
      <div class="login-view">
        <div class="login-desc">Failed to start login. Please try again.</div>
        <button id="login-retry-btn" class="login-btn">Retry</button>
      </div>
    `;
    document.getElementById("login-retry-btn")!.addEventListener("click", () => showLogin());
  }
}
