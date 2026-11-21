# UI Design Guidelines

This document defines the visual design system and UI conventions for Jetyet (`src/web/`), modeled on a YunYoo/Tabler-inspired minimalist flat aesthetic.

## Layout

- **Console Shell**: Top command bar (`max-width: 1360px` centered) with brand + live worker pulse pills on the left, 4-domain segmented view switcher (`Infra`, `Users`, `Templates`, `Activity`) in the center, and compact utility controls on the right. No left sidebar.
- **Spatial In-Place Expand Bento**: Primary collections (`Infra` hosts+nodes and `Users`) render in a responsive spatial grid where clicking any card expands it full-width (`grid-column: 1 / -1`) in-place to reveal live inline telemetry charts, ring meters, and quick controls while sibling cards remain visible directly below. Default to expanding the first host in `Infra` for 0-click telemetry visibility.
- **Full-Canvas `Stage` vs. Lightweight `Modal`**:
  - Use full-canvas `Stage` views (with top `← Back` bar, 2-column live-preview studios, or split IDE) for heavy/rich workflows: creating/editing entities (`EntityForm`), template editing (`TemplateEditor`), full telemetry (`History`), and archives. Never use slide-over drawers.
  - Use crisp flat `Modal` dialogs (`src/web/components/workspace.tsx`) for confirmations (`Confirm`, `ForceRemove`), notices, quick code/link/log inspection (`Code`), and lightweight input prompts (`Correction`, `OperationForm`), so the user keeps spatial context behind the overlay.
- **Login Page**: Render as a centered minimalist card (`max-width: 400px`) on `--paper` with the brand centered above the card and a top-right theme toggle. Do not add decorative top accent stripes or split-screen hero panels.

## Color System & Dark Mode

Always reference CSS custom properties defined in `src/web/styles.css` and support both light (default) and dark (`[data-theme="dark"]`) themes across all components, overlays, and Recharts charts. Never hardcode theme-dependent hex colors in `.tsx` files.

### Surface & Text Tokens

| Token | Light Mode (Default) | Dark Mode (`[data-theme="dark"]`) | Usage |
| --- | --- | --- | --- |
| `--paper` | `#f9fafb` | `#111827` | Page canvas, table headers, code blocks |
| `--surface` | `#ffffff` | `#1f2937` | Cards, panels, sidebar, topbar, inputs, dialogs |
| `--subtle` | `#f3f4f6` | `#283344` | Muted fills, counts, neutral badges, hover tracks |
| `--ink` | `#1f2937` | `#e5e7eb` | Primary text |
| `--muted` | `#6b7280` | `#9ca3af` | Secondary text, labels, icons |
| `--border` | `#e5e7eb` | `#374151` | All `1px solid` borders and dividers |

### Brand & Semantic Tokens

| Token | Light Mode | Dark Mode | Usage |
| --- | --- | --- | --- |
| `--accent` | `#b074d1` | `#b074d1` | Primary brand accent (buttons, active states, focus rings) |
| `--accent-hover` | `#9a5cbf` | `#c08ae0` | Primary button hover |
| `--accent-hover-bg` | `rgba(176, 116, 209, 0.10)` | `rgba(176, 116, 209, 0.14)` | Nav, icon-button, and menu item hover fill |
| `--accent-soft` | `rgba(176, 116, 209, 0.18)` | `rgba(176, 116, 209, 0.24)` | Active nav item and chart area fill |
| `--accent-fg` | `#ffffff` | `#ffffff` | Text on primary/danger buttons |
| `--good` / `--good-soft` | `#0cbc87` / `rgba(12, 188, 135, 0.12)` | `#2dd4a0` / `rgba(45, 212, 160, 0.15)` | Healthy / online states |
| `--warning` / `--warning-soft` | `#f59f00` / `rgba(245, 159, 0, 0.12)` | `#fbbf24` / `rgba(251, 191, 36, 0.15)` | Warning / exhausted states |
| `--danger` / `--danger-soft` | `#d63939` / `rgba(214, 57, 57, 0.12)` | `#f87171` / `rgba(248, 113, 113, 0.15)` | Error / destructive states |

### Theme Persistence

- Default to `prefers-color-scheme`, overridden by `localStorage` key `jetyet-theme` (`"light"` | `"dark"`).
- Initialize `document.documentElement.dataset.theme` and `<meta name="theme-color">` synchronously in `src/web/index.html` to prevent theme flash on load.

## Radii, Borders & Flat Aesthetic

- **Radius Scale**:
  - `--radius-sm` (`4px`): badges, counts, inline indicators.
  - `--radius` (`6px`): buttons, inputs, selects, search bars, nav items, popovers, toasts, code blocks.
  - `--radius-lg` (`8px`): panels, stats strips, template cards, dialogs, login card.
- **Borders**: Use `1px solid var(--border)` uniformly across panels, cards, tables, inputs, and layout chrome.
- **Strict Flat Rules**:
  - Do **not** use dashed dividers (`border-style: dashed`).
  - Do **not** add hover elevation shadows on cards or panels.
  - Do **not** add glassmorphic blur (`backdrop-filter`) on the topbar.
  - Do **not** add decorative colored stripes on headings or cards.
  - Reserve `box-shadow` strictly for floating overlays (`dialog`, `action-popover`, `toast`).

## Components

- **Unified Component Library (`src/web/components/`)**: All reusable UI primitives, form controls, meters, and workspace containers live in `src/web/components/` and are imported through the barrel `src/web/components/index.ts` (`Button`, `Input`, `TextArea`, `SearchInput`, `Select`, `DateTimePicker`, `Checkbox`, `SwitchPill`, `SegmentedControl`, `Chip`, `ChipPicker`, `Badge`, `Field`, `RingMeter`, `MiniBar`, `QuotaBar`, `Stage`, `Confirm`, `Code`, `Empty`, `Table`, `Actions`).
- **No Native OS Controls**: Never use raw browser `<select>`, `<input type="checkbox">`, `<input type="datetime-local">`, or native browser dialogs (`window.confirm`, `alert`, `prompt`) in feature views. Always use the custom styled components from `src/web/components/`.

## Typography, Spacing & Interactions

- **Fonts**: Keep `Space Grotesk Variable` (`--font`) for UI text and `--mono` for metrics, timestamps, addresses, and code.
- **Type Scale**: Page `h1` `clamp(1.5rem, 2.5vw, 1.75rem)` (`700`), section `h2` `15px` (`600`), subheading `h3` `14px` (`600`), body `14px`, compact table/meta `11px–13px`.
- **Spacing**: Maintain `16px–24px` (`--space-4` to `--space-6`) card/panel padding while keeping table rows and operational lists moderately compact.
- **Interactive States**: Sidebar navigation items, icon buttons, and action-popover items use translucent lavender hover (`--accent-hover-bg`) and active (`--accent-soft`) states with `--accent` text.
