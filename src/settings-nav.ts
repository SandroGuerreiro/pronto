// Settings keyboard navigation — pure helpers used by main.ts.

const SETTINGS_TABS = ["general", "notifications", "workflow", "shortcuts", "updates", "subscriptions"] as const;
export type SettingsTabName = typeof SETTINGS_TABS[number];

/** Map a number key ("1"-"6") to a settings tab name. */
export function tabForNumber(key: string): SettingsTabName | null {
  const n = parseInt(key, 10);
  if (isNaN(n) || n < 1 || n > SETTINGS_TABS.length) return null;
  return SETTINGS_TABS[n - 1];
}

// ── Content group navigation ───────────────────────────────────────────────

/**
 * Get all visible settings-group and notif-master-row elements in a container.
 * Checks inline `style.display` because settings code hides groups exclusively
 * via inline style (e.g., `style="display:none"` on merged-window-group, etc.).
 */
export function getVisibleGroups(container: HTMLElement): HTMLElement[] {
  const all = container.querySelectorAll<HTMLElement>(".settings-group, .notif-master-row");
  return [...all].filter((el) => el.style.display !== "none");
}

export type ControlType = "checkbox" | "select" | "input" | "button";
export interface GroupControl {
  type: ControlType;
  element: HTMLElement;
}

/** Find the primary interactive control in a settings group.
 *  Priority: checkbox → select → text input → button. */
export function getGroupControl(group: HTMLElement): GroupControl | null {
  const checkbox = group.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (checkbox) return { type: "checkbox", element: checkbox };

  const select = group.querySelector<HTMLSelectElement>("select");
  if (select) return { type: "select", element: select };

  const textInput = group.querySelector<HTMLInputElement>('input[type="text"]');
  if (textInput) return { type: "input", element: textInput };

  const button = group.querySelector<HTMLButtonElement>("button");
  if (button) return { type: "button", element: button };

  return null;
}
