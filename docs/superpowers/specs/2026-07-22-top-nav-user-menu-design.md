# Sticky Top Nav + User Dropdown Menu — Design Spec

**Date:** 2026-07-22
**Status:** Approved by Carlos (conversation), pending implementation

## Goal

Add a ClickUp-style sticky top navigation bar to the desktop app with a centered
search trigger (existing Cmd+K GlobalSearch) and a user avatar dropdown menu on
the right. Slim the left icon rail down to pure page navigation. Structure the
dropdown so future personal tools (Notepad, Reminders, Whiteboard) drop in
without redesign.

## Decisions made

- **Left rail stays** for page navigation (logo + Home, Workspace, Reports,
  Tasks, Deliverables). Settings moves into the user dropdown.
- **Top nav right side is minimal:** NotificationBell + UserMenu avatar only.
  No quick-action icon row; quick actions live inside the dropdown.
- **Top nav left side is empty:** search centered, controls right.

## Architecture

Single new component `components/dashboard/TopNav.tsx`, rendered once in
`app/(dashboard)/layout.tsx` above `<main>`, spanning everything to the right
of the rail (desktop `lg+` only; hidden on setup pages, same condition as
Sidebar). Because the layout is `h-screen` with `overflow-y-auto` on `<main>`,
the bar is naturally sticky — no scroll listeners needed.

Layout restructure in `app/(dashboard)/layout.tsx`:

```
<div flex h-screen>
  <Sidebar />                     (rail, unchanged position)
  <div flex-1 flex flex-col min-w-0>
    <TopNav />                    (h-14, hidden on mobile — MobileNav covers <lg)
    <div flex flex-1 overflow-hidden>
      <ClientListPanel />         (when shown)
      <main overflow-y-auto>{children}</main>
    </div>
  </div>
</div>
```

Note: ClientListPanel moves inside the new right-hand column so the top bar
spans above it (ClickUp-style). Verify ClientListPanel height behavior after
the move (it should fill the column below the bar).

## Components

### TopNav (`components/dashboard/TopNav.tsx`)

- `h-14 bg-card border-b border-border`, three-zone flex: empty left spacer,
  centered search trigger, right controls.
- **Search trigger:** button styled as an input — `max-w-md w-full`, muted
  background, rounded, Search icon + "Search" placeholder text + `⌘K` kbd chip.
  Opens the existing `GlobalSearch` modal.
- **Cmd+K listener moves here from Sidebar.tsx** (single owner). The
  Cmd+Shift+T timer listener moves with it (it was in the same effect).
- **Right controls:** `NotificationBell` (moves out of the rail), then
  `UserMenu`.
- Owns `GlobalSearch` modal state for desktop. (MobileNav keeps its own
  instance, as today.)

### UserMenu (`components/dashboard/UserMenu.tsx`)

Radix dropdown (`components/ui/dropdown-menu.tsx` if present, else add the
shadcn primitive). Trigger: avatar circle with initials derived from
`useCurrentMember().displayName` + small chevron.

Menu contents, top to bottom:

1. **Identity header** (non-interactive): avatar, displayName, email, role
   badge (Owner / Admin / Member / Viewer).
2. **Settings** → link to `/settings`.
3. Section label: **Personal Tools**
   - **Track Time** → `window.dispatchEvent(new CustomEvent('timer:open-quick-start'))`
     (existing FloatingTimer listener).
   - **My Tasks** → link to `/tasks`.
   - **Send Feedback** → `window.dispatchEvent(new CustomEvent('feedback:open'))`
     — requires adding a listener in `FeedbackWidget` that sets its `open`
     state to true (mirrors the timer event pattern).
   - Future items (Notepad, Reminders, Whiteboard) append to this section.
4. Divider.
5. **Help** — placeholder (same no-op as today's rail button; keeps its home).
6. **Log out** — destructive styling; same Supabase `signOut()` +
   `window.location.href = '/'` logic used today.

### Sidebar changes (`components/dashboard/Sidebar.tsx`)

- Remove: Search button, Help button, NotificationBell, Sign Out button,
  Settings nav item, the Cmd+K/Cmd+Shift+T keydown effect, GlobalSearch modal.
- `navigation` export shrinks to 5 items. **MobileNav imports `navigation`**
  for its drawer — add Settings explicitly to the drawer menu (or a separate
  `drawerNavigation` list) so mobile users don't lose the Settings link.
- Layout: replace `justify-evenly` with a top-aligned stack (`gap-2`-style)
  so 5 icons + logo sit naturally.

### MobileNav changes (`components/dashboard/MobileNav.tsx`)

- Add `UserMenu` (same component, mobile-friendly trigger size) to the top
  bar's right cluster, after NotificationBell.
- Keep existing search button, bell, drawers, and bottom tabs as-is.
- Ensure Settings remains reachable (drawer menu, per above).
- Drawer's Sign Out row stays (harmless duplication with the UserMenu).

### FeedbackWidget changes (`components/feedback/FeedbackWidget.tsx`)

- Add `useEffect` listening for `feedback:open` custom event → `setOpen(true)`.

## Data

No DB, migration, or API work. All data comes from existing hooks:
`useCurrentMember` (name, email, role), existing notification and timer
infrastructure.

## Error handling

- `useCurrentMember.isLoading`: render a skeleton circle for the avatar until
  loaded; initials fall back to first letter of email prefix (hook already
  handles fallback naming).
- Supabase client null (env missing): Log out button no-ops, matching current
  Sidebar behavior.

## Testing

- `npx tsc --noEmit` clean.
- Manual browser verification: Cmd+K opens search from any page; dropdown
  items each fire (Settings nav, timer event, feedback opens, log out);
  rail shows 5 items; mobile top bar shows avatar; Settings reachable on
  mobile; top bar stays fixed while main content scrolls.

## Out of scope

- Notepad, Reminders, Whiteboard (future personal tools — dropdown structure
  accommodates them).
- Theme switcher, status setting, avatar image upload.
- Any change to GlobalSearch internals or notification behavior.
