---
name: "SEO Ops Center Client Portal"
description: "A private progress workspace for invited client contacts."
colors:
  background: "var(--background)"
  foreground: "var(--foreground)"
  card: "var(--card)"
  card-foreground: "var(--card-foreground)"
  popover: "var(--popover)"
  popover-foreground: "var(--popover-foreground)"
  primary: "var(--primary)"
  primary-foreground: "var(--primary-foreground)"
  secondary: "var(--secondary)"
  secondary-foreground: "var(--secondary-foreground)"
  muted: "var(--muted)"
  muted-foreground: "var(--muted-foreground)"
  border: "var(--border)"
  ring: "var(--ring)"
  destructive: "var(--destructive)"
  error-ink: "var(--color-red-700)"
  chart-1: "var(--chart-1)"
  chart-2: "var(--chart-2)"
  chart-4: "var(--chart-4)"
  selection: "color-mix(in oklab, var(--primary) 30%, transparent)"
  primary-tint: "color-mix(in oklab, var(--primary) 10%, transparent)"
  muted-translucent: "color-mix(in oklab, var(--muted) 50%, transparent)"
  border-translucent: "color-mix(in oklab, var(--border) 40%, transparent)"
  technical-surface: "color-mix(in oklab, var(--chart-2) 10%, var(--card))"
  links-surface: "color-mix(in oklab, var(--chart-4) 10%, var(--card))"
  completion-ink: "var(--color-emerald-700)"
  completion-ink-dark: "var(--color-emerald-400)"
  paper: "#ffffff"
  paper-ink: "oklch(20.5% 0 0)"
  transparent: "transparent"
  panel-shadow-color: "rgb(0 0 0 / 8%)"
  menu-shadow-color: "rgb(0 0 0 / 20%)"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(28px, 3.1vw, 46px)"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  metric:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(26px, 3vw, 38px)"
    fontWeight: 800
    lineHeight: 1.3
    letterSpacing: "-0.035em"
  metric-minimum:
    fontSize: "26px"
  page-title:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: "2.25rem"
    letterSpacing: "-0.025em"
  login-title:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: "2rem"
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 800
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  section-heading:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 750
    letterSpacing: "-0.025em"
  content-title:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: "1.75rem"
  client-name:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
  body:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.8
  body-inherited:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  work-title:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.7
  navigation:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
  action:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.5
  label:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    lineHeight: 1.7
  micro:
    fontFamily: "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "10px"
rounded:
  square: "0"
  nav-indicator: "3px"
  week-item: "5px"
  week-grid: "6px"
  action: "7px"
  tooltip: "8px"
  panel: "10px"
  inherited-card: "0.75rem"
  count-pill: "20px"
  status-pill: "30px"
  circle: "50%"
  utility-full: "calc(infinity * 1px)"
spacing:
  tiny: "4px"
  compact: "8px"
  control-gap: "10px"
  small: "12px"
  week: "14px"
  regular: "16px"
  grid-gap: "18px"
  work: "19px"
  phone-panel: "20px"
  week-heading: "22px"
  section: "24px"
  panel: "25px"
  header-gap: "26px"
  journey-gap: "28px"
  section-bottom: "30px"
  desktop-gutter: "32px"
  empty: "34px"
  loading: "40px"
components:
  action:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    typography: "{typography.action}"
    rounded: "{rounded.action}"
    padding: "11px 16px"
  action-hover:
    backgroundColor: "{colors.muted}"
  action-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    typography: "{typography.action}"
    rounded: "{rounded.action}"
    padding: "11px 16px"
  action-secondary-hover:
    backgroundColor: "{colors.muted}"
  panel:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.panel}"
    padding: "25px"
  review-panel:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.panel}"
    padding: "25px"
  message-field:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.inherited-card}"
    padding: "12px"
  navigation:
    backgroundColor: "{colors.card}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.navigation}"
    padding: "12px 0"
  status-progress:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.status-pill}"
    padding: "3px 9px"
  status-done:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.status-pill}"
    padding: "3px 9px"
  work-filter:
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.week-grid}"
    padding: "8px 11px"
  work-filter-selected:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
  journey-current:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.circle}"
    width: "53px"
    height: "53px"
  report-paper:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.inherited-card}"
  text-link:
    textColor: "{colors.foreground}"
    typography: "{typography.navigation}"
---

# Design System: SEO Ops Center Client Portal

## Overview

**Creative North Star: "Visible client progress"**

This document captures the implemented client portal visual system: the portal shell, login, dashboard, client conversations, and the wrappers around shared plans and reports. The staff application, including ClientPortalStaffPanel, is explicitly outside scope. Imported shared plan and report block interiors retain their existing presentation; their full token systems are not redefined here. This is implementation documentation for review and handoff, not evidence of a production release.

The user’s dashboard mockup establishes the portal’s composition and information hierarchy. Its colors, including navy, are illustrative. The implemented portal uses the app’s inherited semantic theme tokens, so organization branding and light/dark mode determine the actual palette. The header, panels, navigation, and actions belong to the same visual language as the app. The final shell and login have no mountain background. Plus Jakarta Sans remains inherited from the existing app. Actual shared data determines content and states.

**Key Characteristics:**

- App semantic colors inherited by the portal without a separate fixed palette.
- Card surfaces, primary actions, and chart tokens that follow the active theme.
- Compact type with strong headings and tabular metrics.
- Visible keyboard focus and layouts that stack for phones.

## Colors

### Primary

Primary marks action borders, navigation and text-link underlines, and the current journey icon. Primary Foreground supplies that icon’s contrast pair. Small action labels use Secondary Foreground on Secondary surfaces rather than primary-colored fills. Small links and buttons that use the primary utility are scoped to Foreground text with a Primary underline; the current milestone label also uses Foreground. Chart 1 supplies the performance line, dots, and legend; the chart area uses that same color at 0.1 fill opacity. The chart hue is inherited, not prescribed as blue.

### Secondary

Secondary and Secondary Foreground support client actions, refresh actions, avatars, progress badges, selected work filters, and team conversation entries. Count badges use Secondary with Foreground. Muted supplies their existing hover or quiet state. These names describe semantic roles rather than fixed hues.

### Tertiary

Technical and link-category activity tiles use the existing 10% mixes of Chart 2 and Chart 4 with Card. Completion icons, positive performance changes, and success feedback use Tailwind’s emerald-700 utility in the light theme and emerald-400 in the dark theme. Completion badges themselves use Muted and Foreground, and completed journey icons use Secondary and Secondary Foreground. Error text and negative performance changes use Tailwind red-700 in light mode and inherited Destructive in dark mode for readable small labels.

### Neutral

Background and Foreground define the shell. Card and Card Foreground define panels and header; Popover and Popover Foreground define the account menu and chart tooltip. Muted Foreground supports descriptions, dates, navigation, and chart ticks. Border separates client identity, panels, weeks, and fields; Ring supplies keyboard focus. Selection, primary tint, translucent muted messages, and report borders retain their source color-mix expressions. Shadow colors retain their source RGB alpha values. Paper and Paper Ink apply only to the existing shared plan/report wrappers and print treatment.

The normative frontmatter deliberately records live CSS variable references and source mixes. Organization branding and dark-mode values can vary; no fixed primary or shell hue is specified here. The sidecar keeps component snippets bound to those same variables and does not manufacture a fixed tonal palette.

**The Inherited Theme Rule.** Use the app’s semantic CSS variables for portal surfaces and actions. Do not replace them with colors sampled from the illustrative mockup.

**The Paper Exception Rule.** Keep shared plan and report paper white with its existing neutral ink; this exception does not define the portal shell palette.

## Typography

All portal shell typography uses Plus Jakarta Sans with the app’s sans-serif fallbacks. The font is supplied by the app’s existing `--font-plus-jakarta` variable. Display and metrics use the two source clamps in the frontmatter; `metric-minimum` records the metric clamp’s lower endpoint, not a separate fixed-size component.

The display role is the dashboard introduction. The page-title and login-title roles are the existing utility-based headings. Headline is the card panel heading, section-heading is the heading above work cards, and content-title is the title of an approval item. Client-name identifies the active client in the header. Work-title identifies individual deliverables. Navigation and action share a compact size but have distinct weight. Body, label, and micro support explanatory copy, dates, chart ticks, and badges. Body-inherited records the root font size for otherwise unsized text.

The frontmatter preserves pixel values from portal CSS and rem values from the app’s utility theme. The current root uses the browser’s standard 16px rem basis. Supplementary text spans 10–12px; work titles use 13px, descriptions 14px, and the desktop client name 15px. Responsive rules use these same steps. The hero description is limited to 75ch. Metrics and numeric badges use tabular numerals. The brand wordmark is uppercase, weight 800, with 0.04em tracking; it shares navigation’s desktop size and micro’s compact size.

## Layout

The main and header containers are at most 1480px wide. Main gutters are 32px on desktop, 20px at the 800px breakpoint, and 16px at the 480px breakpoint. The header has an 82px minimum height on desktop. The upper dashboard pairs performance and client requests in an approximately 1.8:1 grid, with an 18px gap. Work cards use three columns, two below 800px, and one below 480px. Five upcoming weeks become stacked sections below 800px. Navigation moves to its own row below 1200px and scrolls horizontally on narrow phones. The journey changes from three columns to one below 480px; the detailed milestone grid uses the existing 768px utility breakpoint.

Main panels use the panel spacing token, compact work cards use work spacing, and phone panels use phone-panel spacing. Spacing remains deliberately compact rather than a new uniform scale. Messages use the existing 48rem maximum width, report history 56rem, report pages 860px, and login 440px. The footer uses a 1416px maximum width. Text wraps within constrained cards and client identities.

## Elevation & Depth

Card panels use the source’s subtle `0 5px 18px rgb(0 0 0 / 8%)` shadow. The account menu uses `0 12px 32px rgb(0 0 0 / 20%)`. Borders and the inherited Card/Background relationship carry the rest of the depth. The final portal does not render the mockup’s mountain image. Performance uses the theme’s Chart 1 color at 0.1 fill opacity with the existing border grid. Report wrappers retain their existing utility shadow, and printing removes wrapper shadows and corners.

The inherited global color transition lasts 200ms with the existing utility easing. The chart disables animation. Reduced-motion preferences remove transitions and animations within the portal theme; no new entrance or scroll motion is part of this system.

## Shapes

Main panels and the account menu use gently curved panel corners. Primary and secondary actions use the action radius. Week tiles, the week grid, work filters, and the chart tooltip each retain their smaller source radii. Navigation indicators use the smallest rounded step. Count badges use count-pill; statuses and the account trigger use status-pill. Avatars and journey icons use circular clipping. Inherited utility cards and fields use the app’s 0.75rem radius; utility full rounding is preserved for small markers. Printed report wrappers use square corners.

Keyboard interaction has a 3px Ring outline with a 4px offset. The login input specifically overrides the offset to 2px. Disabled buttons use the portal’s 0.6 opacity, with explicit 0.5 utility overrides where present. The CSS gives action buttons and work-filter buttons a 44px minimum height below 480px; the login action has that minimum at every size.

## Components

### Buttons

Client actions use Secondary and Secondary Foreground, a 1px Primary border, the action type role, and 11px by 16px padding. Hover uses Muted. Refresh uses the same surface and text pair with a 1px Border stroke, and also uses Muted on hover. Request changes retains its outlined utility treatment. Preserve descriptive text, busy labels, disabled states, and Ring focus.

### Chips and filters

Progress and completion badges use micro type with weight 700 and 3px by 9px padding. Progress uses Secondary; recorded completion uses Muted and Foreground with a check icon. Text carries meaning independently of color. Work filters use Border and Muted Foreground at rest, then Secondary and Secondary Foreground when selected. Selection is expressed with `aria-pressed`.

### Cards and containers

Main panels and the request panel use Card, Card Foreground, Border, and the panel shadow. Individual work cards reduce padding. Request rows remain Card surfaces. Empty states use the same surfaces and explanatory hierarchy rather than invented metrics. Shared plan and report pages retain their white paper and neutral ink exception.

### Inputs and fields

Login and message inputs use Card, Border, inherited field rounding, and body utility type. Plan notes use Background. Focus remains visible on the actual control. Team conversation entries use Secondary and Border; client entries use half-opacity Muted. Errors use red-700 in light mode and Destructive in dark mode and inline recovery text. Successful messages use the source emerald utility pair.

### Navigation

Horizontal navigation uses Muted Foreground by default, Foreground on hover and the current page, and Primary for the active underline. The current page has a heavier weight. Approvals can include a Secondary count pill. The account disclosure opens a Popover surface with client switching and sign out. Keep the skip link and semantic current-page state. Small primary-utility links and buttons elsewhere use Foreground labels and Primary underlines; this keeps the accent in the decoration rather than in small text.

### Journey and performance

Journey icons are outlined circles using Border and Muted Foreground. The current window uses Primary and Primary Foreground; completed windows use Secondary and Secondary Foreground. Their text derives from dated shared work. Performance pairs tabular metrics with Chart 1, observed monthly dates, a month selector, a theme-aware tooltip, and an accessible data table. Missing values remain unavailable; the chart does not animate or join missing measurements.

The sidecar includes self-contained visual snippets of these existing primitives. They inherit app CSS variables, including the existing font variable, through the preview’s shadow DOM. Illustrative labels demonstrate component styling only; they are not client records or portal data.

## Do's and Don'ts

### Do:

- Do inherit the app’s semantic colors and existing Plus Jakarta Sans for portal components.
- Do use secondary surfaces and text for client actions with primary borders, foreground text with primary underlines for small links, chart tokens for performance, and the source emerald utilities for success feedback.
- Do retain visible keyboard focus, small-screen stacking, and reduced-motion behavior.
- Do let unavailable measurements and dates remain visibly unavailable.

### Don't:

- Don’t apply this portal document as a staff redesign or restyle imported report and plan interiors through it.
- Don’t hardcode the mockup’s navy, blue, coral, or other illustrative colors in portal surfaces.
- Don’t use completion styling to imply that an approved draft was published or delivered.
- Don’t interpret reference fidelity or these documents as confirmation of a production release.
