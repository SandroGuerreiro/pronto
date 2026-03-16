import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeRelease } from "./fixtures";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const mockState = {
  releaseNotesOpen: false,
  releaseNotesIndex: 0,
  setReleaseNotesOpen: vi.fn((v: boolean) => { mockState.releaseNotesOpen = v; }),
  setReleaseNotesIndex: vi.fn((i: number) => { mockState.releaseNotesIndex = i; }),
};

vi.mock("../state", () => mockState);

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

describe("showReleaseNotes", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="content"></div>';
    mockState.releaseNotesOpen = false;
    mockState.releaseNotesIndex = 0;
    vi.clearAllMocks();
  });

  it("renders release cards for each release", async () => {
    const releases = [
      makeRelease({ tag_name: "v0.7.0" }),
      makeRelease({ tag_name: "v0.6.95" }),
      makeRelease({ tag_name: "v0.6.94" }),
    ];
    vi.mocked(invoke).mockResolvedValue(releases);
    const { showReleaseNotes } = await import("../release-notes");
    await showReleaseNotes();
    const cards = document.querySelectorAll(".release-card");
    expect(cards.length).toBe(3);
  });

  it("marks the first release as latest", async () => {
    vi.mocked(invoke).mockResolvedValue([makeRelease()]);
    const { showReleaseNotes } = await import("../release-notes");
    await showReleaseNotes();
    expect(document.querySelector(".release-card.latest")).not.toBeNull();
  });

  it("sets releaseNotesOpen to true", async () => {
    vi.mocked(invoke).mockResolvedValue([makeRelease()]);
    const { showReleaseNotes } = await import("../release-notes");
    await showReleaseNotes();
    expect(mockState.setReleaseNotesOpen).toHaveBeenCalledWith(true);
  });

  it("resets releaseNotesIndex to 0", async () => {
    vi.mocked(invoke).mockResolvedValue([makeRelease()]);
    const { showReleaseNotes } = await import("../release-notes");
    await showReleaseNotes();
    expect(mockState.setReleaseNotesIndex).toHaveBeenCalledWith(0);
  });

  it("renders empty state when no releases", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    const { showReleaseNotes } = await import("../release-notes");
    await showReleaseNotes();
    const empty = document.querySelector(".release-notes-empty");
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toContain("No release notes available");
  });

  it("formats published_at as readable date", async () => {
    vi.mocked(invoke).mockResolvedValue([makeRelease({ published_at: "2026-03-11T14:27:26Z" })]);
    const { showReleaseNotes } = await import("../release-notes");
    await showReleaseNotes();
    const dateEl = document.querySelector(".release-date");
    expect(dateEl).not.toBeNull();
    expect(dateEl!.textContent).toContain("Mar");
    expect(dateEl!.textContent).toContain("2026");
  });

  it("renders markdown in body", async () => {
    vi.mocked(invoke).mockResolvedValue([makeRelease({ body: "**bold** and `code`" })]);
    const { showReleaseNotes } = await import("../release-notes");
    await showReleaseNotes();
    const bodyEl = document.querySelector(".release-body");
    expect(bodyEl!.innerHTML).toContain("<strong>bold</strong>");
    expect(bodyEl!.innerHTML).toContain("<code>code</code>");
  });

  it("adds ARIA attributes for accessibility", async () => {
    vi.mocked(invoke).mockResolvedValue([makeRelease(), makeRelease({ tag_name: "v0.6.95" })]);
    const { showReleaseNotes } = await import("../release-notes");
    await showReleaseNotes();
    const list = document.querySelector(".release-notes-list");
    expect(list?.getAttribute("role")).toBe("listbox");
    expect(list?.getAttribute("aria-label")).toBe("Release notes");
    const cards = document.querySelectorAll(".release-card");
    cards.forEach((card) => expect(card.getAttribute("role")).toBe("option"));
    expect(cards[0].getAttribute("aria-selected")).toBe("true");
  });
});

describe("hideReleaseNotes", () => {
  beforeEach(() => {
    mockState.releaseNotesOpen = false;
    mockState.releaseNotesIndex = 0;
    vi.clearAllMocks();
  });

  it("sets releaseNotesOpen to false", async () => {
    const { hideReleaseNotes, initReleaseNotes } = await import("../release-notes");
    initReleaseNotes(() => {});
    hideReleaseNotes();
    expect(mockState.setReleaseNotesOpen).toHaveBeenCalledWith(false);
  });

  it("calls the injected onClose callback", async () => {
    const onClose = vi.fn();
    const { hideReleaseNotes, initReleaseNotes } = await import("../release-notes");
    initReleaseNotes(onClose);
    hideReleaseNotes();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("navigateReleaseNotes", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="content"></div>';
    mockState.releaseNotesOpen = false;
    mockState.releaseNotesIndex = 0;
    vi.clearAllMocks();
  });

  it("moves focus down with positive delta", async () => {
    vi.mocked(invoke).mockResolvedValue([makeRelease(), makeRelease({ tag_name: "v0.6.95" })]);
    const { showReleaseNotes, navigateReleaseNotes } = await import("../release-notes");
    await showReleaseNotes();
    navigateReleaseNotes(1);
    expect(mockState.releaseNotesIndex).toBe(1);
  });

  it("clamps at the bottom", async () => {
    vi.mocked(invoke).mockResolvedValue([makeRelease(), makeRelease({ tag_name: "v0.6.95" })]);
    const { showReleaseNotes, navigateReleaseNotes } = await import("../release-notes");
    await showReleaseNotes();
    navigateReleaseNotes(1);
    navigateReleaseNotes(1);
    expect(mockState.releaseNotesIndex).toBe(1);
  });

  it("clamps at the top", async () => {
    vi.mocked(invoke).mockResolvedValue([makeRelease()]);
    const { showReleaseNotes, navigateReleaseNotes } = await import("../release-notes");
    await showReleaseNotes();
    navigateReleaseNotes(-1);
    expect(mockState.releaseNotesIndex).toBe(0);
  });

  it("adds focused class to the correct card", async () => {
    vi.mocked(invoke).mockResolvedValue([makeRelease(), makeRelease({ tag_name: "v0.6.95" })]);
    const { showReleaseNotes, navigateReleaseNotes } = await import("../release-notes");
    await showReleaseNotes();
    navigateReleaseNotes(1);
    const cards = document.querySelectorAll(".release-card");
    expect(cards[0].classList.contains("focused")).toBe(false);
    expect(cards[1].classList.contains("focused")).toBe(true);
  });

  it("updates aria-selected on focused card", async () => {
    vi.mocked(invoke).mockResolvedValue([makeRelease(), makeRelease({ tag_name: "v0.6.95" })]);
    const { showReleaseNotes, navigateReleaseNotes } = await import("../release-notes");
    await showReleaseNotes();
    navigateReleaseNotes(1);
    const cards = document.querySelectorAll(".release-card");
    expect(cards[0].getAttribute("aria-selected")).toBe("false");
    expect(cards[1].getAttribute("aria-selected")).toBe("true");
  });
});

describe("openFocusedRelease", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="content"></div>';
    vi.clearAllMocks();
  });

  it("opens the focused release URL in the browser", async () => {
    vi.mocked(invoke).mockResolvedValue([
      makeRelease({ html_url: "https://github.com/SandroGuerreiro/pronto/releases/tag/v0.7.0" }),
    ]);
    const { showReleaseNotes, openFocusedRelease } = await import("../release-notes");
    await showReleaseNotes();
    openFocusedRelease();
    expect(openUrl).toHaveBeenCalledWith("https://github.com/SandroGuerreiro/pronto/releases/tag/v0.7.0");
  });
});
