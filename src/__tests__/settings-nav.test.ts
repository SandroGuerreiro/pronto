import { describe, it, expect, afterEach } from "vitest";
import {
  tabForNumber,
  getVisibleGroups,
  getGroupControl,
} from "../settings-nav";

// ---------------------------------------------------------------------------
// tabForNumber
// ---------------------------------------------------------------------------

describe("tabForNumber", () => {
  it("maps 1 to general", () => {
    expect(tabForNumber("1")).toBe("general");
  });

  it("maps 2 to notifications", () => {
    expect(tabForNumber("2")).toBe("notifications");
  });

  it("maps 3 to workflow", () => {
    expect(tabForNumber("3")).toBe("workflow");
  });

  it("maps 4 to shortcuts", () => {
    expect(tabForNumber("4")).toBe("shortcuts");
  });

  it("maps 5 to updates", () => {
    expect(tabForNumber("5")).toBe("updates");
  });

  it("maps 6 to subscriptions", () => {
    expect(tabForNumber("6")).toBe("subscriptions");
  });

  it("returns null for 0", () => {
    expect(tabForNumber("0")).toBeNull();
  });

  it("returns null for 7", () => {
    expect(tabForNumber("7")).toBeNull();
  });

  it("returns null for non-number", () => {
    expect(tabForNumber("a")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getVisibleGroups
// ---------------------------------------------------------------------------

describe("getVisibleGroups", () => {
  function makeContainer(html: string): HTMLElement {
    const div = document.createElement("div");
    div.innerHTML = html;
    document.body.appendChild(div);
    return div;
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns visible settings-group and notif-master-row elements", () => {
    const container = makeContainer(`
      <div class="settings-content">
        <div class="settings-group">A</div>
        <div class="settings-group">B</div>
        <div class="notif-master-row">C</div>
      </div>
    `);
    const groups = getVisibleGroups(container.querySelector(".settings-content")!);
    expect(groups).toHaveLength(3);
  });

  it("excludes groups hidden with inline style", () => {
    const container = makeContainer(`
      <div class="settings-content">
        <div class="settings-group">A</div>
        <div class="settings-group" style="display:none">B</div>
      </div>
    `);
    const groups = getVisibleGroups(container.querySelector(".settings-content")!);
    expect(groups).toHaveLength(1);
  });

  it("returns empty array when container has no groups", () => {
    const container = makeContainer(`<div class="settings-content"></div>`);
    const groups = getVisibleGroups(container.querySelector(".settings-content")!);
    expect(groups).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getGroupControl
// ---------------------------------------------------------------------------

describe("getGroupControl", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function makeGroup(html: string): HTMLElement {
    const div = document.createElement("div");
    div.className = "settings-group";
    div.innerHTML = html;
    document.body.appendChild(div);
    return div;
  }

  it("finds checkbox in group", () => {
    const group = makeGroup(`<label><input type="checkbox" class="settings-toggle" /></label>`);
    const result = getGroupControl(group);
    expect(result).toEqual({ type: "checkbox", element: group.querySelector("input") });
  });

  it("finds select in group", () => {
    const group = makeGroup(`<select class="settings-select"><option>A</option></select>`);
    const result = getGroupControl(group);
    expect(result).toEqual({ type: "select", element: group.querySelector("select") });
  });

  it("finds text input in group", () => {
    const group = makeGroup(`<input type="text" class="settings-input" />`);
    const result = getGroupControl(group);
    expect(result).toEqual({ type: "input", element: group.querySelector("input") });
  });

  it("finds button in group", () => {
    const group = makeGroup(`<button class="login-btn">Add</button>`);
    const result = getGroupControl(group);
    expect(result).toEqual({ type: "button", element: group.querySelector("button") });
  });

  it("returns null for group with no interactive element", () => {
    const group = makeGroup(`<span>Just text</span>`);
    expect(getGroupControl(group)).toBeNull();
  });

  it("prefers checkbox over button in mixed groups", () => {
    const group = makeGroup(`
      <input type="checkbox" class="settings-toggle" />
      <button class="login-btn">Remove</button>
    `);
    const result = getGroupControl(group);
    expect(result?.type).toBe("checkbox");
  });
});
