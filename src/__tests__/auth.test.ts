import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { exit } from "@tauri-apps/plugin-process";
import { initAuth, showLogin, showPatInput, showPermissionsInfo, startLogin } from "../auth";
import type { DeviceCodeResponse } from "../types";

function setupDom() {
  document.body.innerHTML = `
    <div id="content"></div>
    <div id="signout-btn"></div>
    <div id="main-nav"></div>
  `;
}

function makeDeviceCodeResponse(overrides: Partial<DeviceCodeResponse> = {}): DeviceCodeResponse {
  return {
    device_code: "dc_abc123",
    user_code: "ABCD-1234",
    verification_uri: "https://github.com/login/device",
    expires_in: 900,
    interval: 5,
    ...overrides,
  };
}

describe("initAuth", () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
  });

  it("stores the callback for later use by PAT login", async () => {
    const onSuccess = vi.fn();
    initAuth(onSuccess);

    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    showPatInput();

    const input = document.getElementById("pat-input") as HTMLInputElement;
    input.value = "ghp_valid_token";
    (document.getElementById("pat-connect-btn") as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
  });
});

describe("showLogin", () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    initAuth(vi.fn());
  });

  it("renders login view with correct buttons", () => {
    showLogin();

    expect(document.getElementById("login-btn")).not.toBeNull();
    expect(document.getElementById("pat-btn")).not.toBeNull();
    expect(document.getElementById("login-quit-btn")).not.toBeNull();
    expect(document.querySelector(".login-title")!.textContent).toBe("Connect to GitHub");
  });

  it("hides signout button and main nav", () => {
    showLogin();

    expect(document.getElementById("signout-btn")!.style.display).toBe("none");
    expect(document.getElementById("main-nav")!.style.display).toBe("none");
  });

  it("click 'Sign in with GitHub' triggers startLogin", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("network error"));
    showLogin();

    document.getElementById("login-btn")!.click();

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_login");
    });
  });

  it("click 'Use Personal Access Token' shows PAT input", () => {
    showLogin();

    document.getElementById("pat-btn")!.click();

    expect(document.getElementById("pat-input")).not.toBeNull();
    expect(document.getElementById("pat-connect-btn")).not.toBeNull();
  });

  it("click 'Quit' calls exit", async () => {
    showLogin();

    document.getElementById("login-quit-btn")!.click();

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(0);
    });
  });
});

describe("showPatInput", () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    initAuth(vi.fn());
  });

  it("renders PAT form with input, connect, and back buttons", () => {
    showPatInput();

    expect(document.getElementById("pat-input")).not.toBeNull();
    expect(document.getElementById("pat-connect-btn")).not.toBeNull();
    expect(document.getElementById("pat-back-btn")).not.toBeNull();
    expect(document.getElementById("perm-info-link")).not.toBeNull();
    expect(document.querySelector(".login-title")!.textContent).toBe("Personal Access Token");
  });

  it("shows error when token is empty", async () => {
    showPatInput();

    const input = document.getElementById("pat-input") as HTMLInputElement;
    input.value = "";
    (document.getElementById("pat-connect-btn") as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(document.getElementById("pat-error")!.textContent).toBe("Please enter a token.");
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("shows error when token is only whitespace", async () => {
    showPatInput();

    const input = document.getElementById("pat-input") as HTMLInputElement;
    input.value = "   ";
    (document.getElementById("pat-connect-btn") as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(document.getElementById("pat-error")!.textContent).toBe("Please enter a token.");
    });
  });

  it("calls invoke and onLoginSuccess on valid token", async () => {
    const onSuccess = vi.fn();
    initAuth(onSuccess);
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    showPatInput();

    const input = document.getElementById("pat-input") as HTMLInputElement;
    input.value = "ghp_validtoken123";
    (document.getElementById("pat-connect-btn") as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("login_with_pat", { token: "ghp_validtoken123" });
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it("disables button and shows 'Validating...' while connecting", async () => {
    let resolveInvoke!: () => void;
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveInvoke = resolve; }),
    );

    showPatInput();

    const input = document.getElementById("pat-input") as HTMLInputElement;
    const btn = document.getElementById("pat-connect-btn") as HTMLButtonElement;
    input.value = "ghp_test";
    btn.click();

    await vi.waitFor(() => {
      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe("Validating...");
    });

    resolveInvoke();
  });

  it("shows error and re-enables button on failed token", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("invalid"));

    showPatInput();

    const input = document.getElementById("pat-input") as HTMLInputElement;
    const btn = document.getElementById("pat-connect-btn") as HTMLButtonElement;
    input.value = "ghp_badtoken";
    btn.click();

    await vi.waitFor(() => {
      expect(document.getElementById("pat-error")!.textContent).toBe(
        "Invalid token. Please check and try again.",
      );
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe("Connect");
    });
  });

  it("Enter key on input triggers connect", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    const onSuccess = vi.fn();
    initAuth(onSuccess);

    showPatInput();

    const input = document.getElementById("pat-input") as HTMLInputElement;
    input.value = "ghp_enterkey";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("login_with_pat", { token: "ghp_enterkey" });
    });
  });

  it("non-Enter key does not trigger connect", () => {
    showPatInput();

    const input = document.getElementById("pat-input") as HTMLInputElement;
    input.value = "ghp_test";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));

    expect(invoke).not.toHaveBeenCalled();
  });

  it("Back button returns to login view", () => {
    showPatInput();

    document.getElementById("pat-back-btn")!.click();

    expect(document.getElementById("login-btn")).not.toBeNull();
    expect(document.querySelector(".login-title")!.textContent).toBe("Connect to GitHub");
  });

  it("permissions info link shows permissions view", () => {
    showPatInput();

    document.getElementById("perm-info-link")!.click();

    expect(document.querySelector(".permissions-view")).not.toBeNull();
  });
});

describe("showPermissionsInfo", () => {
  beforeEach(() => {
    setupDom();
    vi.clearAllMocks();
    initAuth(vi.fn());
  });

  it("renders permissions info with classic and fine-grained sections", () => {
    showPermissionsInfo();

    const content = document.getElementById("content")!;
    expect(document.querySelector(".login-title")!.textContent).toBe("Required Permissions");
    expect(content.textContent).toContain("Classic Token");
    expect(content.textContent).toContain("Fine-grained Token");
    expect(content.textContent).toContain("repo");
    expect(content.textContent).toContain("Contents");
    expect(content.textContent).toContain("Metadata");
    expect(content.textContent).toContain("Pull requests");
  });

  it("classic link opens GitHub tokens URL", () => {
    showPermissionsInfo();

    document.getElementById("perm-classic-link")!.click();

    expect(openUrl).toHaveBeenCalledWith("https://github.com/settings/tokens");
  });

  it("fine-grained link opens GitHub fine-grained tokens URL", () => {
    showPermissionsInfo();

    document.getElementById("perm-fine-link")!.click();

    expect(openUrl).toHaveBeenCalledWith("https://github.com/settings/tokens?type=beta");
  });

  it("Back button returns to PAT input", () => {
    showPermissionsInfo();

    document.getElementById("perm-back-btn")!.click();

    expect(document.getElementById("pat-input")).not.toBeNull();
    expect(document.querySelector(".login-title")!.textContent).toBe("Personal Access Token");
  });
});

describe("startLogin", () => {
  beforeEach(() => {
    setupDom();
    vi.useFakeTimers();
    vi.clearAllMocks();
    initAuth(vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows connecting message initially", async () => {
    vi.mocked(invoke).mockImplementation(
      () => new Promise(() => {}),
    );

    const promise = startLogin();
    await vi.waitFor(() => {
      expect(document.querySelector(".login-desc")!.textContent).toBe("Connecting to GitHub...");
    });

    // Don't await the never-resolving promise
    void promise;
  });

  it("shows device code view on successful start_login", async () => {
    const resp = makeDeviceCodeResponse();
    vi.mocked(invoke).mockResolvedValueOnce(resp);

    await startLogin();

    expect(document.getElementById("device-code")!.textContent).toBe("ABCD-1234");
    expect(document.getElementById("verify-link")!.textContent).toBe("https://github.com/login/device");
    expect(document.querySelector(".login-status")!.textContent).toBe("Waiting for authorization...");
    expect(document.getElementById("oauth-back-btn")).not.toBeNull();
  });

  it("device code click copies to clipboard", async () => {
    const resp = makeDeviceCodeResponse();
    vi.mocked(invoke).mockResolvedValueOnce(resp);

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    await startLogin();

    document.getElementById("device-code")!.click();

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("ABCD-1234");
    });
  });

  it("shows 'Copied!' feedback after clicking device code", async () => {
    const resp = makeDeviceCodeResponse();
    vi.mocked(invoke).mockResolvedValueOnce(resp);

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    await startLogin();

    document.getElementById("device-code")!.click();

    await vi.waitFor(() => {
      expect(document.getElementById("copy-feedback")!.textContent).toBe("Copied!");
    });

    vi.advanceTimersByTime(2000);
    expect(document.getElementById("copy-feedback")!.textContent).toBe("");
  });

  it("verify link opens verification URL", async () => {
    const resp = makeDeviceCodeResponse();
    vi.mocked(invoke).mockResolvedValueOnce(resp);

    await startLogin();

    document.getElementById("verify-link")!.click();

    expect(openUrl).toHaveBeenCalledWith("https://github.com/login/device");
  });

  it("poll_login returns true calls onLoginSuccess", async () => {
    const onSuccess = vi.fn();
    initAuth(onSuccess);

    const resp = makeDeviceCodeResponse();
    vi.mocked(invoke)
      .mockResolvedValueOnce(resp)
      .mockResolvedValueOnce(true);

    await startLogin();

    await vi.advanceTimersByTimeAsync(8000);

    expect(invoke).toHaveBeenCalledWith("poll_login", { deviceCode: "dc_abc123" });
    expect(onSuccess).toHaveBeenCalled();
  });

  it("uses minimum 8s poll interval even if response says less", async () => {
    const onSuccess = vi.fn();
    initAuth(onSuccess);

    const resp = makeDeviceCodeResponse({ interval: 2 });
    vi.mocked(invoke)
      .mockResolvedValueOnce(resp)
      .mockResolvedValueOnce(true);

    await startLogin();

    await vi.advanceTimersByTimeAsync(5000);
    expect(invoke).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(invoke).toHaveBeenCalledWith("poll_login", { deviceCode: "dc_abc123" });
  });

  it("poll_login throws shows error with retry", async () => {
    const resp = makeDeviceCodeResponse();
    vi.mocked(invoke)
      .mockResolvedValueOnce(resp)
      .mockRejectedValueOnce(new Error("expired"));

    await startLogin();

    await vi.advanceTimersByTimeAsync(8000);

    await vi.waitFor(() => {
      expect(document.querySelector(".login-desc")!.textContent).toBe(
        "Authorization failed. Please try again.",
      );
      expect(document.getElementById("login-retry-btn")).not.toBeNull();
    });
  });

  it("poll_login error retry button returns to login view", async () => {
    const resp = makeDeviceCodeResponse();
    vi.mocked(invoke)
      .mockResolvedValueOnce(resp)
      .mockRejectedValueOnce(new Error("expired"));

    await startLogin();
    await vi.advanceTimersByTimeAsync(8000);

    await vi.waitFor(() => {
      expect(document.getElementById("login-retry-btn")).not.toBeNull();
    });

    document.getElementById("login-retry-btn")!.click();

    expect(document.getElementById("login-btn")).not.toBeNull();
    expect(document.querySelector(".login-title")!.textContent).toBe("Connect to GitHub");
  });

  it("start_login throws shows error with retry", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("network error"));

    await startLogin();

    expect(document.querySelector(".login-desc")!.textContent).toBe(
      "Failed to start login. Please try again.",
    );
    expect(document.getElementById("login-retry-btn")).not.toBeNull();
  });

  it("start_login error retry button returns to login view", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("network error"));

    await startLogin();

    document.getElementById("login-retry-btn")!.click();

    expect(document.getElementById("login-btn")).not.toBeNull();
    expect(document.querySelector(".login-title")!.textContent).toBe("Connect to GitHub");
  });

  it("back button clears poll interval and returns to login", async () => {
    const resp = makeDeviceCodeResponse();
    vi.mocked(invoke).mockResolvedValueOnce(resp);

    await startLogin();

    document.getElementById("oauth-back-btn")!.click();

    expect(document.getElementById("login-btn")).not.toBeNull();

    vi.mocked(invoke).mockClear();
    await vi.advanceTimersByTimeAsync(16000);
    expect(invoke).not.toHaveBeenCalledWith("poll_login", expect.anything());
  });

  it("does not double-poll while a poll request is in flight", async () => {
    const resp = makeDeviceCodeResponse();
    let resolvePoll!: (v: boolean) => void;
    vi.mocked(invoke)
      .mockResolvedValueOnce(resp)
      .mockImplementationOnce(
        () => new Promise<boolean>((resolve) => { resolvePoll = resolve; }),
      );

    await startLogin();

    await vi.advanceTimersByTimeAsync(8000);
    expect(invoke).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(8000);
    expect(invoke).toHaveBeenCalledTimes(2);

    resolvePoll(false);
  });

  it("continues polling when poll_login returns false", async () => {
    const onSuccess = vi.fn();
    initAuth(onSuccess);

    const resp = makeDeviceCodeResponse();
    vi.mocked(invoke)
      .mockResolvedValueOnce(resp)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await startLogin();

    await vi.advanceTimersByTimeAsync(8000);
    expect(onSuccess).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(8000);
    expect(onSuccess).toHaveBeenCalled();
  });
});
