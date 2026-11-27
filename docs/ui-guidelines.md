# UI Design Guidelines

This document defines the visual design system and UI conventions for Jetyet (`src/web/`), modeled on a YunYoo/Tabler-inspired minimalist flat aesthetic.

## Layout

- **Console Shell**: Top command bar (`max-width: 1360px` centered) with the brand on the left, 5-domain segmented view switcher (`Overview`, `Infra`, `Users`, `Templates`, `Activity`) in the center, and compact utility controls on the right. No left sidebar. Default to `Overview` when no saved view is stored.
- **Overview Dashboard**: Present top-level operational KPIs (reachable VPS, healthy nodes, online clients, active alerts and running tasks), a compact **Control Plane Host** summary card linking to its full card in `Infra`, a platform aggregate traffic chart (`1h`/`24h`/`7d`/`30d`, switchable between all managed VPS traffic and all user VPN traffic), an alerts and quota watchlist, and current-period Top N traffic rankings for VPS and users.
- **Activity Triage & Virtualized History**: Render `Activity` as a bounded two-column top triage strip (**Open Alerts** with bulk mark-all-read and entity jump chips alongside **Active Tasks & Workers** with live heartbeat badges) above a full-width history panel with segmented tabs (`Alerts`, `Operations`, `Audit Events`), defaulting to `Alerts` filtered to `Open`. Keep search, a filter icon-button popover (status/type/state/category and hiding high-frequency `kick` tasks by default), and refresh on one single header row. Render history rows inside a variable-height virtualized infinite-scroll list (`ScrollArea`) with expandable long errors and audit payloads.
- **Row-Anchored In-Place Expand Bento**: Primary collections (`Infra` hosts+nodes and `Users`) render in a responsive spatial grid where compact cards stay in their original positions (never sorted to the top). Clicking a card highlights it in place and inserts a full-width detail panel (`grid-column: 1 / -1`) directly below that card's grid row to reveal live inline telemetry charts (`1h`/`24h`/`7d`/`30d`), ring meters, and quick controls while preserving scroll context and preventing empty grid gaps. Keep expanded columns height-decoupled: cap right-column chip lists with internal overlay scrolling (`ScrollArea`) and pin quick actions at the bottom so left metrics and the center chart never deform. Animate transitions when supported and honor reduced motion. Restore the last console view and collection expansion state from browser storage, defaulting to all collapsed when no saved state exists. Render the **Control Plane Host** as a distinct special expandable card in `Infra` excluded from managed VPS counts.
- **Full-Canvas `Stage` vs. Lightweight `Modal`**:
  - Use full-canvas `Stage` views (with top `← Back` bar, 2-column live-preview studios, or split IDE) for heavy/rich workflows: creating/editing entities (`EntityForm`), template editing (`TemplateEditor`), full telemetry (`History`), and archives. Never use slide-over drawers.
  - Use crisp flat `Modal` dialogs (`src/web/components/workspace.tsx`) for confirmations (`Confirm`, `ForceRemove`), notices, quick code/link/log inspection (`Code`), and lightweight input prompts (`Correction`, `OperationForm`), so the user keeps spatial context behind the overlay.
  - Use the unified split `QrCodeModal` layout (template and format selectors + single-line URL on the left, scannable QR code on the right, copy action in the footer) for both the administrator subscription links dialog and the Subscription Portal dialog. Keep the portal password link dialog in its focused single-link modal layout. Keep one scrollable body with the footer outside it.
- **Subscription Portal**: Put the default subscription first, followed by traffic usage and then template selection. Show accounted usage against the configured quota, the current period and next reset in Asia/Hong_Kong, and inbound and outbound traffic for the latest 24 hourly buckets. Use the portal's initial data for the metrics and show an empty chart state when no samples exist. Group assigned and personal templates in one picker and show only the selected template's pinned link and controls. Load personal template source when the editor opens.
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

## Interface Languages

- The initial release supports English and Simplified Chinese (`zh-Hans`).
- Both languages cover the full web interface: the management console, Subscription Portal, shared sign-in, and portal password setup.
- On first visit, use the highest-priority supported browser language and default to English if none matches. Store an explicit language choice in the current browser and honor it across pages and sign-out.
- Show only the current language's flag in the header. Open a compact dropdown with a flag and endonym for each option, and mark the selected language.
- Localize product copy, statuses, validation, and common errors. Format dates and numbers for the selected language. Display dates in the Asia/Hong_Kong timezone.
- Preserve names entered by users, subscription configuration, commands, and third-party diagnostic details. Pair third-party errors with a localized summary when shown in the interface.

## Brand

- The Jetyet brand mark is the approved Lucide rocket outline, drawn in the brand accent (`#b074d1`). The rocket represents liftoff.
- Use the same rocket mark in the management console, Subscription Portal, shared sign-in, password setup, and favicon.
- Pair the rocket with the custom vector wordmark in page headers and auth views. Use the wordmark only as part of the brand.
- Localize browser tab titles as `Page name · Jetyet`. Update the title when switching primary views. Dialogs and editor stages retain the parent view's title.

## Scrolling

- Use custom overlay scrollbars on both axes in every scrollable area. Scrollbars do not reserve layout space.
- Reveal the scrollbar on pointer hover, keyboard focus within the region, or active scrolling. Fade it when idle. Support dragging with a desktop pointer and preserve keyboard, wheel, and touch scrolling.

## Typography, Spacing & Interactions

- **Font Stacks**:
  - `--font`: use `"Space Grotesk Variable", sans-serif` for the English interface. Serve the Latin variable font with the app. In Simplified Chinese, use Arial for Latin text followed by platform CJK sans-serif families such as PingFang SC, Microsoft YaHei, and Noto Sans CJK SC.
  - `--mono`: `ui-monospace, "Cascadia Code", Consolas, monospace` for metrics, timestamps, addresses, URLs, logs, and template code. Add platform CJK fallbacks in the Simplified Chinese interface.
- **Type Scale & Tokens**: Use `rem` tokens (`--text-2xs` `0.625rem` / 10px, `--text-xs` `0.6875rem` / 11px, `--text-sm` `0.75rem` / 12px, `--text-md` `0.8125rem` / 13px, `--text-base` `0.875rem` / 14px, `--text-lg` `0.9375rem` / 15px, `--text-xl` `1rem` / 16px, `--text-2xl` `1.25rem` / 20px, `--text-h1` `clamp(1.5rem, 2.5vw, 1.75rem)`) so typography respects browser root font-size preferences. Headings use `text-wrap: balance`; helper and guidance copy use `text-wrap: pretty`.
- **UI Typography Usage**: Map every UI text role to an explicit font family, size token, and weight in `src/web/styles.css`:

| Text Role | Family | Size Token | Weight | CSS Targets / Usage |
| --- | --- | --- | --- | --- |
| Page & stage heading (`h1`) | `--font` | `--text-h1` (`--text-2xl` in `.stage-title-row`) | `700` | Top-level stage headings (`h1`, `.stage-title-row h1`) |
| Section & modal heading (`h2`) | `--font` | `--text-lg` (`--text-xl` in `.modal-title-wrap`) | `600` (`700` in modals) | Panel, template card, and modal headings (`h2`, `.template-card-head h2`, `.modal-title-wrap h2`) |
| Card & subsection heading (`h3`) | `--font` | `--text-base` | `600` (`550` in empty states) | Subsection and empty-state headings (`h3`, `.empty h3`, `.quiet h3`) |
| Body (default) | `--font` | `--text-base` | `400` (`600` on `.compact-name` / `.preview-name`) | Document root and primary card titles (`body`) |
| Body (compact) & inputs | `--font` | `--text-md` | `400` (`600` on active/strong items) | Modal/focus copy, inputs, selects, portal items (`.modal-body`, `.focus-content`, `input`, `select`, `.ui-select-*`, `.portal-tpl-item`) |
| Body (secondary) & form labels | `--font` | `--text-sm` | `400` (`550`–`600` on labels/legends) | Muted copy, `small`, `.field`, `legend`, alerts, toasts, banners (`.muted`, `small`, `.field`, `legend`, `.error-banner`, `.toast`) |
| Buttons (base) | `--font` | `--text-base` | `400` | Default `<button>` controls |
| Buttons (navigation) | `--font` | `--text-md` | `500` (`600` when `.active`) | Command dock tabs (`.dock-item`) |
| Buttons (compact & utility) | `--font` | `--text-sm` | `500` (`600` selected; `400` on `.text-button` / menus) | `.stage-back`, `.segmented-control button`, `.toggle-pill`, `.pick-chip`, `.subtle-button`, `.quick-row-btn`, `.action-popover button`, `.text-button` |
| Buttons (action rows) | `--font` | `--text-md` | `400` | Collection, editor, dialog and portal action rows |
| Buttons (micro actions) | `--font` | `--text-xs` | `400` | Table row actions and chart range pills (`.row-buttons button`, `.range-tabs button`) |
| Captions & metadata | `--font` | `--text-xs` | `400` (`500`–`600` on pills/avatars) | Subtitles, chips, badges, legends, timestamps, counts, and helper notes |
| Micro-labels & KPIs | `--font` | `--text-2xs` | `600` (`400` on `.field small`) | `.kpi-label`, `.dock-item b`, `.stale-tag`, `.mini-bar-head`, `.panel-heading .muted`, `.field small` |
| Tables (cells & row links) | `--font` | `--text-sm` | `400` (`600` on `.name-button`) | Table rows and clickable entity names (`table`, `.name-button`) |
| Tables (headers & cell subtext) | `--font` | `--text-2xs` | `550` (`400` on `td > small`) | Column headers and secondary cell captions (`th`, `td > small`) |
| Code blocks & template source | `--mono` | `--text-xs` (`--text-sm` in `.template-source`) | `400` | Preformatted code, template cards, monospace textareas, URLs (`.code-output`, `.template-card pre`, `.field textarea`, `.template-source`, `.link-row-url`) |
| Code & telemetry (micro) | `--mono` | `--text-2xs` | `400` | Event logs, chart axes, quota/alert timestamps (`.event-line pre`, `.chart`, `.alert-row small`, `.quota small`) |
- **Locale-Aware Leading & Tracking**:
  - Default (English): use `1.5` for body text and section headings and `1.3` for page headings. Use `1.65` in code and slight negative tracking on headings.
  - Simplified Chinese (`:root:lang(zh)`): use `1.35` for headings and `1.58` for body text. Set heading tracking to zero and uppercase label tracking to `0.04em`.
- **Numerals**: Apply `font-variant-numeric: tabular-nums` to `.mono`, `pre`, tables, counts, ring values, KPI figures, and quota readouts for stable column alignment across both languages.
- **Spacing**: Maintain `16px–24px` (`--space-4` to `--space-6`) card/panel padding while keeping table rows and operational lists moderately compact.
- **Control Rows**: Use `--action-height` for collection search fields and action buttons. The shared `Chip` and `Badge` styles use `--badge-height` (`1.5rem` minimum), matching type size, leading, and padding. Center them within the row. Use `--utility-height` for the language trigger, theme, and account controls. Let groups wrap on narrow screens.
- **Interactive States**: Sidebar navigation items, icon buttons, and action-popover items use translucent lavender hover (`--accent-hover-bg`) and active (`--accent-soft`) states with `--accent` text.
