/**
 * Accessibility checker for CSS design tokens.
 * Runs as a pre-commit hook to catch contrast and font-size violations.
 *
 * Checks:
 * 1. WCAG AA contrast ratios for all defined text/background pairings
 * 2. Minimum font sizes (no value below 11px)
 * 3. No bare `outline: none` without a :focus-visible replacement
 *
 * Usage: npx tsx scripts/a11y-check.ts
 * Exit code 1 on failure.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// ── Types ────────────────────────────────────────────────────────────────────

interface ContrastPairing {
  readonly name: string;
  readonly fg: string;
  readonly bg: string;
  readonly minRatio: number; // WCAG AA: 4.5 normal text, 3.0 large text
}

interface Violation {
  readonly rule: string;
  readonly message: string;
  readonly line?: number;
}

// ── Color math (WCAG 2.1 relative luminance) ────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hexToRgb(hex1));
  const l2 = relativeLuminance(hexToRgb(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ── Configuration ────────────────────────────────────────────────────────────

// Define which text colors appear on which backgrounds.
// Update these when you change design tokens.
const CONTRAST_PAIRINGS: readonly ContrastPairing[] = [
  // Primary text on all surfaces
  { name: "text-primary on surface-1",   fg: "", bg: "", minRatio: 4.5 },
  { name: "text-primary on surface-2",   fg: "", bg: "", minRatio: 4.5 },
  { name: "text-primary on surface-3",   fg: "", bg: "", minRatio: 4.5 },

  // Secondary text on all surfaces
  { name: "text-secondary on surface-1", fg: "", bg: "", minRatio: 4.5 },
  { name: "text-secondary on surface-2", fg: "", bg: "", minRatio: 4.5 },
  { name: "text-secondary on surface-3", fg: "", bg: "", minRatio: 4.5 },

  // Tertiary text on all surfaces
  { name: "text-tertiary on surface-1",  fg: "", bg: "", minRatio: 4.5 },
  { name: "text-tertiary on surface-2",  fg: "", bg: "", minRatio: 4.5 },
  { name: "text-tertiary on surface-3",  fg: "", bg: "", minRatio: 4.5 },

  // Semantic text colors on their own backgrounds
  { name: "success-text on success-bg",  fg: "", bg: "", minRatio: 3.0 },
  { name: "danger-text on danger-bg",    fg: "", bg: "", minRatio: 3.0 },
  { name: "info-text on info-bg",        fg: "", bg: "", minRatio: 3.0 },
  { name: "attention-text on attention-bg", fg: "", bg: "", minRatio: 3.0 },
  { name: "merged-text on merged-bg",    fg: "", bg: "", minRatio: 3.0 },

  // Semantic text colors on surface-1 (where they commonly appear)
  { name: "success-text on surface-1",   fg: "", bg: "", minRatio: 4.5 },
  { name: "danger-text on surface-1",    fg: "", bg: "", minRatio: 4.5 },
  { name: "info-text on surface-1",      fg: "", bg: "", minRatio: 4.5 },
  { name: "attention-text on surface-1", fg: "", bg: "", minRatio: 4.5 },
  { name: "merged-text on surface-1",    fg: "", bg: "", minRatio: 4.5 },
  { name: "neutral-text on surface-1",   fg: "", bg: "", minRatio: 4.5 },
];

const MIN_FONT_SIZE_PX = 11;

// ── Token extraction ─────────────────────────────────────────────────────────

function extractTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const tokenRegex = /--([\w-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = tokenRegex.exec(css)) !== null) {
    tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

function resolveHex(tokens: Map<string, string>, key: string): string | null {
  const value = tokens.get(key);
  if (!value) return null;

  // Direct hex
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;

  // var() reference
  const varMatch = value.match(/var\(--([^)]+)\)/);
  if (varMatch) return resolveHex(tokens, varMatch[1]);

  // rgba() -- resolve the opaque color on surface-1 (approximate)
  const rgbaMatch = value.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  if (rgbaMatch) {
    const [, r, g, b, a] = rgbaMatch;
    const alpha = parseFloat(a);
    // Blend against surface-1 background
    const bgHex = resolveHex(tokens, "surface-1") || "#1A1A1D";
    const bgRgb = hexToRgb(bgHex).map(c => Math.round(c * 255));
    const blended = [
      Math.round(parseInt(r) * alpha + bgRgb[0] * (1 - alpha)),
      Math.round(parseInt(g) * alpha + bgRgb[1] * (1 - alpha)),
      Math.round(parseInt(b) * alpha + bgRgb[2] * (1 - alpha)),
    ];
    return "#" + blended.map(c => c.toString(16).padStart(2, "0")).join("");
  }

  return null;
}

// Map token name fragments to CSS variable names
const TOKEN_MAP: Record<string, string> = {
  "surface-1":     "surface-1",
  "surface-2":     "surface-2",
  "surface-3":     "surface-3",
  "text-primary":  "text-primary",
  "text-secondary":"text-secondary",
  "text-tertiary": "text-tertiary",
  "success-text":  "color-success-text",
  "success-bg":    "color-success-bg",
  "danger-text":   "color-danger-text",
  "danger-bg":     "color-danger-bg",
  "info-text":     "color-info-text",
  "info-bg":       "color-info-bg",
  "attention-text":"color-attention-text",
  "attention-bg":  "color-attention-bg",
  "merged-text":   "color-merged-text",
  "merged-bg":     "color-merged-bg",
  "neutral-text":  "color-neutral-text",
};

function resolveToken(tokens: Map<string, string>, name: string): string | null {
  const varName = TOKEN_MAP[name];
  if (!varName) return null;
  return resolveHex(tokens, varName);
}

// ── Checks ───────────────────────────────────────────────────────────────────

function checkContrast(tokens: Map<string, string>): readonly Violation[] {
  const violations: Violation[] = [];

  for (const pairing of CONTRAST_PAIRINGS) {
    const fgName = pairing.name.split(" on ")[0];
    const bgName = pairing.name.split(" on ")[1];

    const fg = resolveToken(tokens, fgName);
    const bg = resolveToken(tokens, bgName);

    if (!fg || !bg) continue; // skip unresolvable tokens

    const ratio = contrastRatio(fg, bg);
    if (ratio < pairing.minRatio) {
      violations.push({
        rule: "contrast",
        message: `${pairing.name}: ratio ${ratio.toFixed(2)}:1 < required ${pairing.minRatio}:1 (fg: ${fg}, bg: ${bg})`,
      });
    }
  }

  return violations;
}

function checkFontSizes(css: string): readonly Violation[] {
  const violations: Violation[] = [];
  const lines = css.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match font-size declarations with px values
    const pxMatch = line.match(/font-size\s*:\s*(\d+(?:\.\d+)?)px/);
    if (pxMatch) {
      const size = parseFloat(pxMatch[1]);
      if (size < MIN_FONT_SIZE_PX) {
        violations.push({
          rule: "font-size",
          message: `font-size: ${size}px is below minimum ${MIN_FONT_SIZE_PX}px`,
          line: i + 1,
        });
      }
    }

    // Match CSS variable definitions for font sizes
    const varMatch = line.match(/--text-\w+\s*:\s*(\d+(?:\.\d+)?)px/);
    if (varMatch) {
      const size = parseFloat(varMatch[1]);
      if (size < MIN_FONT_SIZE_PX) {
        violations.push({
          rule: "font-size",
          message: `token ${line.trim().split(":")[0]}: ${size}px is below minimum ${MIN_FONT_SIZE_PX}px`,
          line: i + 1,
        });
      }
    }
  }

  return violations;
}

function checkOutlineNone(css: string): readonly Violation[] {
  const violations: Violation[] = [];
  const lines = css.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (/outline\s*:\s*none/.test(lines[i])) {
      // Check if next few lines contain a :focus-visible rule
      const context = lines.slice(Math.max(0, i - 5), i + 10).join("\n");
      if (!context.includes("focus-visible")) {
        violations.push({
          rule: "outline",
          message: `outline: none without :focus-visible replacement`,
          line: i + 1,
        });
      }
    }
  }

  return violations;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const cssPath = resolve(import.meta.dirname!, "../src/styles.css");
  const css = readFileSync(cssPath, "utf-8");
  const tokens = extractTokens(css);

  const allViolations = [
    ...checkContrast(tokens),
    ...checkFontSizes(css),
    ...checkOutlineNone(css),
  ];

  if (allViolations.length === 0) {
    console.log("\x1b[32m✓ Accessibility checks passed\x1b[0m");
    process.exit(0);
  }

  console.error(`\x1b[31m✗ ${allViolations.length} accessibility violation(s) found:\x1b[0m\n`);

  for (const v of allViolations) {
    const location = v.line ? ` (line ${v.line})` : "";
    console.error(`  \x1b[33m[${v.rule}]\x1b[0m ${v.message}${location}`);
  }

  console.error("\nFix these issues before committing.");
  process.exit(1);
}

main();
