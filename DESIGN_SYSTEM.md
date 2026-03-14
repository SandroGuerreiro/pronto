# Pronto Design System

> **"Served Fresh"** — Pronto delivers your PRs on a silver platter.
> The brand is warm, attentive, and service-oriented.

---

## Brand Identity

### Name & Voice
**Pronto** (Italian: "ready", Spanish: "quick") — the app that keeps your PRs ready and served fresh. The voice is confident but approachable, efficient but never cold. Think: a seasoned maitre d' who knows exactly what you need before you ask.

### Logo
Illustrative mark: a hand serving a platter with a check-marked dish. Communicates speed, service, and completion. Used at 30px height in the panel header. Always render on dark backgrounds.

### Brand Color
**Amber Gold** `#D4A017` — the signature color. Represents attention, warmth, and urgency without alarm. Used for badges, attention states, and the tray icon badge. This is the color people associate with Pronto.

---

## Color System

All colors are defined as CSS custom properties in `:root`. The palette is built on warm neutrals (slight amber undertone) rather than pure grays.

### Surfaces (dark-to-light layering)
| Token | Value | Usage | WCAG |
|-------|-------|-------|------|
| `--surface-base` | `#111113` | App background, behind panel | — |
| `--surface-1` | `#1A1A1D` | Panel background | — |
| `--surface-2` | `#222226` | Elevated cards, popovers | — |
| `--surface-3` | `#2A2A2F` | Dropdowns, modals | — |
| `--surface-hover` | `rgba(255,255,255,0.06)` | Hover state overlay | — |
| `--surface-active` | `rgba(255,255,255,0.10)` | Active/pressed state | — |

### Text
| Token | Value | Usage | Contrast on surface-1 |
|-------|-------|-------|-----------------------|
| `--text-primary` | `#EDEDF0` | Headings, PR titles, primary content | 14.2:1 AAA |
| `--text-secondary` | `#9D9DA6` | Descriptions, meta info, labels | 5.4:1 AA |
| `--text-tertiary` | `#5C5C66` | Hints, placeholders, disabled | 2.8:1 AA-large |
| `--text-inverse` | `#111113` | Text on light backgrounds (buttons) | — |

### Borders
| Token | Value | Usage |
|-------|-------|-------|
| `--border-subtle` | `rgba(255,255,255,0.06)` | Section dividers, panel borders |
| `--border-default` | `rgba(255,255,255,0.10)` | Input borders, card borders |
| `--border-strong` | `rgba(255,255,255,0.18)` | Focus rings, active borders |

### Semantic Colors
Each semantic color has three variants: the base, a muted background, and a text-safe version.

| Semantic | Base | Background (15% opacity) | Text | Purpose |
|----------|------|--------------------------|------|---------|
| **Attention** | `#D4A017` | `rgba(212,160,23,0.15)` | `#E8B84A` | Needs review, badges, brand accent |
| **Success** | `#2DA44E` | `rgba(45,164,78,0.15)` | `#3FB950` | Approved, checks pass, open PR |
| **Danger** | `#DA3633` | `rgba(218,54,51,0.15)` | `#F85149` | Changes requested, checks fail, errors |
| **Info** | `#388BFD` | `rgba(56,139,253,0.15)` | `#58A6FF` | Links, focus states, informational |
| **Merged** | `#8957E5` | `rgba(137,87,229,0.15)` | `#A371F7` | Merged PRs |
| **Neutral** | `#6E7681` | `rgba(110,118,129,0.15)` | `#8B949E` | Draft, closed, disabled |

### Why these colors?
- **Amber over yellow**: Pure yellow (#EAB308) can feel harsh. `#D4A017` is warmer, more golden, and reads as "important" rather than "warning."
- **GitHub-aligned semantics**: Success green, danger red, and merged purple match GitHub's own PR status colors, reducing cognitive load for developers who live in GitHub.
- **Warm neutrals**: The surface/text grays have a slight warm cast (blue channel slightly lower) preventing the "cold terminal" feel.

---

## Typography

### Font Stack

```css
/* UI Font — Figtree */
--font-ui: "Figtree", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;

/* Monospace — for PR numbers, code, keybindings */
--font-mono: "JetBrains Mono", "SF Mono", "Fira Code", "Cascadia Code", monospace;
```

**Why Figtree?**
- Geometric sans-serif with warm, rounded terminals
- Excellent legibility at 10-13px (critical for a 480px popup)
- Open, friendly character that matches the playful logo
- Variable font with weights 300-900 (we use 400, 500, 600)
- Free, open-source (SIL Open Font License)
- Not overused in dev tools — distinctive without being distracting

**Why JetBrains Mono?**
- Industry standard for developer tools
- Distinguished 0/O and 1/l/I glyphs
- Excellent at small sizes
- Optional ligatures for operators

### Loading
Bundle Figtree as a local font file to avoid network dependency (menu bar app must work offline). Variable font covers weights 300-900 (we use 400, 500, 600).

```css
@font-face {
  font-family: "Figtree";
  src: url("/fonts/Figtree-Variable.ttf") format("truetype");
  font-weight: 300 900;
  font-style: normal;
  font-display: swap;
}
```

### Type Scale (Minor Third — 1.2 ratio)

| Token | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| `--text-xs` | 10px | 500 | 1.4 | PR numbers, badges, nav labels |
| `--text-sm` | 11px | 400 | 1.4 | Meta info, status details, hints |
| `--text-base` | 13px | 400 | 1.4 | PR titles, body text, inputs |
| `--text-md` | 15px | 600 | 1.3 | Settings titles, section headers |
| `--text-lg` | 18px | 600 | 1.2 | Login title, empty state headers |

### Letter Spacing
| Context | Value |
|---------|-------|
| Uppercase labels (nav, sections) | `0.04em` |
| Body text | `0` (default) |
| Monospace (PR numbers, keys) | `0.02em` |

---

## Spacing & Layout

### Spacing Scale (4px base)
| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 2px | Tight gaps, inline spacing |
| `--space-2` | 4px | Icon-text gaps, chip padding |
| `--space-3` | 6px | Small component gaps |
| `--space-4` | 8px | Standard padding, card gaps |
| `--space-5` | 12px | Section spacing, content padding |
| `--space-6` | 16px | Settings content padding |
| `--space-7` | 20px | Large section gaps |
| `--space-8` | 24px | View padding |
| `--space-10` | 32px | Page-level spacing |

### Border Radius
| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 4px | Keybinding keys, small buttons |
| `--radius-md` | 6px | Input fields, accordion headers |
| `--radius-lg` | 8px | PR cards, settings groups, buttons |
| `--radius-xl` | 12px | Panel, popovers |
| `--radius-full` | 999px | Badges, pills, search input, avatars |

### Layout Constants
| Token | Value | Purpose |
|-------|-------|---------|
| `--panel-margin` | 8px | Space between panel and window edge |
| `--panel-radius` | 12px | Panel corner radius |
| `--sidebar-width` | 64px | Navigation sidebar width |
| `--settings-sidebar-width` | 72px | Settings nav width |
| `--content-padding` | 8px | Main content area padding |

---

## Iconography

### Style
Use **text-based glyphs** (Unicode symbols) for nav icons, consistent with the current approach. This keeps the bundle small and renders crisply at any size.

| Icon | Glyph | Usage |
|------|-------|-------|
| Owned | `⊕` | Owned PRs tab |
| Followed | `◉` | Followed tab |
| Merged | `✓` | Merged tab |
| Closed | `✕` | Closed tab |
| Settings | `⚙` | Settings button |
| Profile | `◐` | Profile button |
| Sign out | `↪` | Sign out button |

### SVG Icons
For inline icons (search, comments, copy, external link), use inline SVGs at consistent sizes:
- **Small**: 12x12px (inline with text — comment icons, status icons)
- **Medium**: 13x13px (search bar icon)
- **Standard**: 16x16px (nav icons)

All SVGs use `currentColor` for fill/stroke to inherit text color.

---

## Component Patterns

### Interactive States
Every interactive element follows this state progression:

| State | Surface | Text | Border |
|-------|---------|------|--------|
| Default | transparent | `--text-secondary` | none |
| Hover | `--surface-hover` | `--text-primary` | none |
| Active/Selected | `--surface-active` | `--text-primary` | none |
| Focus (keyboard) | `rgba(56,139,253,0.08)` | — | `rgba(56,139,253,0.5)` |
| Disabled | — | `--text-tertiary` | — |

### PR Card States
| State | Left Border | Glow |
|-------|-------------|------|
| Default | transparent | none |
| Attention | `--color-attention` | Subtle amber inset glow, pulsing |
| Keyboard focus | — | Blue outline |

### Badges
- Background: `--color-attention` (#D4A017)
- Text: `--text-primary` (#EDEDF0)
- Shape: fully rounded (`--radius-full`)
- Min-width: 14px (sidebar), 16px (inline)
- Font: `--text-xs` (10px), weight 600, tabular-nums
- Animation: gentle scale pulse (2.5s cycle)

### Buttons
| Variant | Background | Text | Border |
|---------|------------|------|--------|
| Primary | `--text-primary` (#EDEDF0) | `--text-inverse` | none |
| Secondary | transparent | `--text-tertiary` | `--border-default` |
| Ghost | transparent | `--text-secondary` | none |
| Danger (confirming) | `rgba(218,54,51,0.08)` | `--color-danger-text` | none |

### Inputs
- Background: `rgba(255,255,255,0.05)`
- Border: `--border-default` on rest, `--border-strong` on focus
- Text: `--text-primary`
- Placeholder: `--text-tertiary`
- Border radius: `--radius-md` (standard inputs), `--radius-full` (search)

### Toggle Switches
- Off: `rgba(255,255,255,0.10)` track, `--text-secondary` knob
- On: `--color-success` (#2DA44E) track, white knob
- Size: 36x20px (standard), 40x22px (master toggles)
- Transition: 200ms ease

---

## Motion & Animation

### Principles
1. **Purposeful, not decorative** — animations communicate state changes
2. **Fast** — max 250ms for micro-interactions, 400ms for exits
3. **Ease-out** for entrances, **ease-in** for exits
4. **Reduce motion** — respect `prefers-reduced-motion`

### Animation Tokens
| Token | Duration | Easing | Usage |
|-------|----------|--------|-------|
| `--duration-fast` | 150ms | ease | Hover states, color changes |
| `--duration-normal` | 250ms | ease-out | Card entrances, slide-ins |
| `--duration-slow` | 400ms | ease-out | Card exits, page transitions |
| `--duration-pulse` | 2.5s | ease-in-out | Attention pulse, badge pulse |

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Accessibility

### Contrast Requirements
- **Body text** (13px+): minimum 4.5:1 (WCAG AA)
- **Large text** (15px+ bold, 18px+): minimum 3:1 (WCAG AA)
- **UI components** (borders, icons): minimum 3:1

### Keyboard Navigation
- All interactive elements focusable via Tab
- Custom keyboard navigation (j/k/h/l) within PR list
- Visible focus indicators: 1px solid blue outline with 8% blue background
- Focus never trapped — Esc closes popup

### Screen Reader Considerations
- Semantic HTML: `<nav>`, `<header>`, `<details>`, `<button>`
- `title` attributes on nav buttons
- `alt` text on logo and avatar
- Status badges should use `aria-label` for count context

### Color Independence
- Never use color alone to convey meaning
- PR status uses icon + color (e.g., `✓` + green for approved)
- Attention state uses border + glow + color

---

## File Organization

```
public/
  fonts/
    Figtree-Variable.woff2
    JetBrainsMono-Variable.woff2
  logo.png

src/
  styles.css          # All styles with design tokens in :root
```

Fonts are bundled locally (not CDN) since this is an offline-capable desktop app.

---

## Quick Reference Card

```
Brand color:     #D4A017 (Amber Gold)
Panel bg:        #1A1A1D
Card hover:      rgba(255,255,255,0.06)
Text primary:    #EDEDF0
Text secondary:  #9D9DA6
Success:         #2DA44E / #3FB950
Danger:          #DA3633 / #F85149
Info:            #388BFD / #58A6FF
Merged:          #8957E5 / #A371F7

Font:            Figtree (400/500/600)
Mono:            JetBrains Mono
Base size:       13px
Scale:           10 → 11 → 13 → 15 → 18

Spacing base:    4px
Radius:          4 / 6 / 8 / 12 / 999
Transition:      150ms (fast) / 250ms (normal) / 400ms (slow)
```
