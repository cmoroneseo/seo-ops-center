# Sticky Top Nav + User Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sticky desktop top nav (centered Cmd+K search trigger, right-side bell + user avatar dropdown) and slim the left rail to pure page navigation.

**Architecture:** New `TopNav` + `UserMenu` components mounted once in `app/(dashboard)/layout.tsx`, in a right-hand flex column above ClientListPanel + main. Dropdowns follow the existing hand-rolled pattern from `NotificationBell` (useState + outside-click refs) — no new dependencies. Spec: `docs/superpowers/specs/2026-07-22-top-nav-user-menu-design.md`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind v4, lucide-react, Supabase auth.

## Global Constraints

- No new npm dependencies.
- No DB/migration/API changes.
- No component test infra exists in this repo — verification per task is `npx tsc --noEmit` (must be clean) plus browser checks in the final task. Do not add a test framework.
- Never add `Co-Authored-By:` or any trailer to commit messages.
- All work on branch `feat/top-nav-user-menu` (already created).
- Preserve existing custom events: `timer:open-quick-start` (FloatingTimer listens), and add `feedback:open` (Task 1).

---

### Task 1: FeedbackWidget `feedback:open` event listener

**Files:**
- Modify: `components/feedback/FeedbackWidget.tsx`

**Interfaces:**
- Produces: dispatching `window.dispatchEvent(new CustomEvent('feedback:open'))` opens the feedback panel. Task 2's UserMenu relies on this.

- [ ] **Step 1: Add the listener effect**

Inside the `FeedbackWidget` component (after the existing `useState` declarations, around line 37), add:

```tsx
    // Open on demand from anywhere (e.g. the user menu) — mirrors the
    // timer:open-quick-start pattern.
    useEffect(() => {
        const handleOpen = () => setOpen(true);
        window.addEventListener('feedback:open', handleOpen);
        return () => window.removeEventListener('feedback:open', handleOpen);
    }, []);
```

`useEffect` is already imported in this file (line 3).

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/feedback/FeedbackWidget.tsx
git commit -m "Add feedback:open event listener to FeedbackWidget"
```

---

### Task 2: UserMenu component

**Files:**
- Create: `components/dashboard/UserMenu.tsx`

**Interfaces:**
- Consumes: `useCurrentMember()` from `@/lib/hooks/useCurrentMember` → `{ displayName: string; email: string; role: 'owner'|'admin'|'member'|'viewer'; isLoading: boolean }`; custom events `timer:open-quick-start` and `feedback:open`.
- Produces: `export function UserMenu()` — self-contained avatar button + dropdown, no props. Tasks 3 and 6 render it.

- [ ] **Step 1: Create the component**

Create `components/dashboard/UserMenu.tsx` with exactly:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown, Settings, Clock, CheckSquare,
  MessageSquarePlus, HelpCircle, LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase() || '?';
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

export function UserMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { displayName, email, role, isLoading } = useCurrentMember();

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  async function signOut() {
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    if (supabase) {
      await supabase.auth.signOut();
      window.location.href = '/';
    }
  }

  function fireEvent(name: string) {
    setIsOpen(false);
    window.dispatchEvent(new CustomEvent(name));
  }

  const itemClass =
    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent/20 transition-colors';

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'flex items-center gap-1 rounded-xl p-1.5 transition-colors',
          isOpen ? 'bg-primary/10' : 'hover:bg-accent/20',
        )}
        title="Account"
      >
        {isLoading ? (
          <span className="h-8 w-8 rounded-full bg-muted animate-pulse" />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
            {initialsOf(displayName)}
          </span>
        )}
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full mt-2 z-[200] w-64 rounded-xl border border-border bg-card p-2 shadow-xl shadow-black/10"
        >
          {/* Identity header */}
          <div className="flex items-center gap-3 px-3 py-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
              {initialsOf(displayName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
            <span className="ml-auto shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              {ROLE_LABELS[role] ?? 'Member'}
            </span>
          </div>

          <div className="my-1 h-px bg-border" />

          <Link href="/settings" onClick={() => setIsOpen(false)} className={itemClass}>
            <Settings className="h-4 w-4 text-muted-foreground" />
            Settings
          </Link>

          <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Personal Tools
          </p>
          <button onClick={() => fireEvent('timer:open-quick-start')} className={itemClass}>
            <Clock className="h-4 w-4 text-muted-foreground" />
            Track Time
          </button>
          <Link href="/tasks" onClick={() => setIsOpen(false)} className={itemClass}>
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
            My Tasks
          </Link>
          <button onClick={() => fireEvent('feedback:open')} className={itemClass}>
            <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
            Send Feedback
          </button>

          <div className="my-1 h-px bg-border" />

          <button className={itemClass} title="Help Guides">
            <HelpCircle className="h-4 w-4 text-muted-foreground" />
            Help
          </button>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/UserMenu.tsx
git commit -m "Add UserMenu avatar dropdown component"
```

---

### Task 3: TopNav component

**Files:**
- Create: `components/dashboard/TopNav.tsx`

**Interfaces:**
- Consumes: `GlobalSearch` (`@/components/dashboard/GlobalSearch`, props `{ isOpen: boolean; onClose: () => void }`), `NotificationBell` (`@/components/notifications/NotificationBell`, no props), `UserMenu` from Task 2.
- Produces: `export function TopNav()` — desktop-only sticky header; sole owner of the Cmd+K and Cmd+Shift+T keydown listeners. Task 5 mounts it; Task 4 removes the old listeners from Sidebar.

- [ ] **Step 1: Create the component**

Create `components/dashboard/TopNav.tsx` with exactly:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { GlobalSearch } from '@/components/dashboard/GlobalSearch';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { UserMenu } from '@/components/dashboard/UserMenu';

export function TopNav() {
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Global shortcuts. Single owner: moved here from Sidebar.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
      // Cmd+Shift+T — open floating timer quick-start
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 't') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('timer:open-quick-start'));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <header className="hidden lg:flex h-14 shrink-0 items-center gap-4 border-b border-border bg-card px-4">
      <div className="flex-1" />

      <button
        onClick={() => setIsSearchOpen(true)}
        className="flex w-full max-w-md items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search</span>
        <kbd className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium">
          ⌘K
        </kbd>
      </button>

      <div className="flex flex-1 items-center justify-end gap-1">
        <NotificationBell />
        <UserMenu />
      </div>

      <GlobalSearch isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </header>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/TopNav.tsx
git commit -m "Add TopNav with centered search trigger and user controls"
```

---

### Task 4: Reposition NotificationBell panel + slim the Sidebar

These change together: once the bell leaves the rail, its panel anchor and the rail contents are both wrong.

**Files:**
- Modify: `components/notifications/NotificationBell.tsx` (panel positioning, ~line 143)
- Modify: `components/dashboard/Sidebar.tsx` (full rewrite below)

**Interfaces:**
- Consumes: nothing new.
- Produces: `navigation` export from Sidebar shrinks to 5 items (Settings removed) — Task 6 compensates in MobileNav's drawer. Bell panel now anchors below-right of the bell button (top-bar placement).

- [ ] **Step 1: Reposition the bell panel**

In `components/notifications/NotificationBell.tsx`, the dropdown was positioned to open rightward from the rail. Replace:

```tsx
        <div
          ref={dropdownRef}
          className="absolute left-16 bottom-0 z-[200] w-80 max-h-[480px] flex flex-col rounded-xl border border-border bg-card shadow-xl shadow-black/10"
        >
```

with:

```tsx
        <div
          ref={dropdownRef}
          className="absolute right-0 top-full mt-2 z-[200] w-80 max-h-[480px] flex flex-col rounded-xl border border-border bg-card shadow-xl shadow-black/10"
        >
```

Also update the stale comment above it from `{/* Dropdown — opens to the right of the sidebar */}` to `{/* Dropdown — opens below the top-bar bell */}`.

(This also fixes the panel's placement in MobileNav's top bar, where the old rail-relative offsets were wrong.)

- [ ] **Step 2: Rewrite Sidebar**

Replace the entire contents of `components/dashboard/Sidebar.tsx` with:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CheckSquare, Briefcase, ClipboardList, PackageCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

export const navigation = [
  { name: 'Home', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Workspace', href: '/workspace', icon: Briefcase },
  { name: 'Reports', href: '/reports', icon: ClipboardList },
  { name: 'Tasks', href: '/tasks', icon: CheckSquare },
  { name: 'Deliverables', href: '/deliverables', icon: PackageCheck },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="hidden lg:flex h-full w-20 flex-col bg-card border-r border-border items-center py-4">
      <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-primary-foreground font-bold text-xl shadow-lg shadow-primary/20">
        A
      </div>

      <nav className="mt-8 flex flex-col items-center gap-3 w-full px-2">
        {navigation.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'relative group flex items-center justify-center h-12 w-12 rounded-xl transition-all duration-200',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                  : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'
              )}
            >
              <item.icon className="h-6 w-6" />
              <div className="absolute left-16 px-2 py-1 bg-popover text-popover-foreground text-xs font-medium rounded border border-border opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                {item.name}
              </div>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
```

Removed: Search button + GlobalSearch modal, Help button, NotificationBell, Sign Out, Settings nav item, keydown effect, TimeLogModal (+ its unused `useClients` fetch and `isTimeLogOpen` state — the modal was only openable from state nothing else set).

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: **errors are possible here** if anything else imports the removed pieces — but MobileNav (drawer nav + its own Settings need) is handled in Task 6. If the only errors point at `MobileNav.tsx`, proceed; any other error, fix before committing.

- [ ] **Step 4: Commit**

```bash
git add components/notifications/NotificationBell.tsx components/dashboard/Sidebar.tsx
git commit -m "Slim sidebar to pure page nav; anchor bell panel for top bar"
```

---

### Task 5: Mount TopNav in the dashboard layout

**Files:**
- Modify: `app/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: `TopNav` from Task 3.
- Produces: final layout structure — rail | column(TopNav / row(ClientListPanel | main)).

- [ ] **Step 1: Restructure the layout JSX**

In `app/(dashboard)/layout.tsx`, add the import:

```tsx
import { TopNav } from '@/components/dashboard/TopNav';
```

Then replace the returned JSX inside `<TimerProvider>`'s first child `div` — currently:

```tsx
            <div className="flex h-screen overflow-hidden bg-background">
                {!isSetupPage && <Sidebar />}
                {!isSetupPage && <MobileNav showClientList={showProjectSidebar} />}
                {showProjectSidebar && <ClientListPanel />}
                <main className={cn(
                    "flex-1 min-w-0 overflow-y-auto",
                    isSetupPage
                        ? "flex flex-col items-center justify-center"
                        // Base padding, then mobile top/bottom offsets to clear the fixed bars.
                        : "p-4 sm:p-6 lg:p-8 pt-[calc(3.5rem+1rem)] pb-20 lg:pt-8 lg:pb-8"
                )}>
                    {children}
                </main>
                {/* OnboardingChecklist hidden until tasks are updated for public launch */}
                {/* {!isSetupPage && <OnboardingChecklist />} */}
            </div>
```

with:

```tsx
            <div className="flex h-screen overflow-hidden bg-background">
                {!isSetupPage && <Sidebar />}
                {!isSetupPage && <MobileNav showClientList={showProjectSidebar} />}
                <div className="flex flex-1 min-w-0 flex-col">
                    {!isSetupPage && <TopNav />}
                    <div className="flex flex-1 min-h-0">
                        {showProjectSidebar && <ClientListPanel />}
                        <main className={cn(
                            "flex-1 min-w-0 overflow-y-auto",
                            isSetupPage
                                ? "flex flex-col items-center justify-center"
                                // Base padding, then mobile top/bottom offsets to clear the fixed bars.
                                : "p-4 sm:p-6 lg:p-8 pt-[calc(3.5rem+1rem)] pb-20 lg:pt-8 lg:pb-8"
                        )}>
                            {children}
                        </main>
                    </div>
                </div>
                {/* OnboardingChecklist hidden until tasks are updated for public launch */}
                {/* {!isSetupPage && <OnboardingChecklist />} */}
            </div>
```

Note `min-h-0` on the inner row — without it the row can overflow the column and break `overflow-y-auto` scrolling in `<main>`.

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: same state as end of Task 4 (only MobileNav-related errors permitted, if any).

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/layout.tsx"
git commit -m "Mount TopNav above client panel and main content"
```

---

### Task 6: MobileNav — UserMenu in top bar, Settings back in drawer

**Files:**
- Modify: `components/dashboard/MobileNav.tsx`

**Interfaces:**
- Consumes: `UserMenu` from Task 2; slimmed `navigation` (5 items) from Task 4.
- Produces: mobile parity — avatar menu in the top bar, Settings still reachable via drawer.

- [ ] **Step 1: Add imports**

In `components/dashboard/MobileNav.tsx` add:

```tsx
import { Settings } from 'lucide-react';
import { UserMenu } from '@/components/dashboard/UserMenu';
```

(`Settings` joins the existing lucide-react import list; keep one import statement.)

- [ ] **Step 2: Drawer navigation with Settings**

Below the `primaryTabs` array, add:

```tsx
// Drawer shows all pages; Settings lives here now that the rail dropped it
// (desktop reaches it via the user menu).
const drawerNavigation = [
  ...navigation,
  { name: 'Settings', href: '/settings', icon: Settings },
];
```

In the full-menu drawer JSX, change `{navigation.map((item) => {` to `{drawerNavigation.map((item) => {`.

- [ ] **Step 3: Add UserMenu to the top bar**

In the top bar's right cluster, after the NotificationBell wrapper:

```tsx
          <div className="flex h-11 w-11 items-center justify-center">
            <NotificationBell />
          </div>
          <UserMenu />
```

- [ ] **Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: no errors (this resolves any Task 4 leftovers).

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/MobileNav.tsx
git commit -m "Add user menu to mobile top bar; keep Settings in drawer"
```

---

### Task 7: Browser verification

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server and load the app**

Use the browser preview (launch.json dev server) at `http://localhost:3000/dashboard`, logged in.

- [ ] **Step 2: Desktop checks (1280×800)**

- Top bar spans from the rail's right edge to the viewport edge; search trigger centered with ⌘K chip.
- Cmd+K opens GlobalSearch; Escape closes; clicking the search trigger also opens it.
- Rail shows logo + exactly 5 icons (no search/help/bell/logout/settings).
- Bell opens its panel *below* the bell, right-aligned, fully visible.
- Avatar dropdown: identity header (name, email, role badge), Settings navigates to `/settings`, Track Time opens the timer quick-start, My Tasks navigates to `/tasks`, Send Feedback opens the feedback panel, Log out returns to `/`.
- Navigate to Workspace: top bar sits above the client list panel; main content scrolls under a fixed top bar.

- [ ] **Step 3: Mobile checks (375×812)**

- Top bar shows menu, logo, (clients), search, bell, avatar — no overflow.
- Avatar dropdown opens and fits on screen; drawer menu includes Settings.

- [ ] **Step 4: Fix anything found, re-verify, commit fixes**

```bash
git add -A
git commit -m "Polish top nav after browser verification"
```

(Skip the commit if nothing changed.)

- [ ] **Step 5: Final gate**

Run: `npx tsc --noEmit` — clean. Then hand off per finishing-a-development-branch (push + PR/merge per Carlos's workflow; check for pending Codex PRs before merging).
