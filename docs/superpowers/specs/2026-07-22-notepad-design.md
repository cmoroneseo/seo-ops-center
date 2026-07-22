# Notepad Personal Tool — Design

**Date:** 2026-07-22
**Status:** Approved by Carlos (pending spec review)

## Summary

A ClickUp-style personal Notepad, opened from the UserMenu → Personal Tools section. Floating panel available on any dashboard page. Rich text notes, personal-only (per member), with one SEO-PM superpower: Convert to Task.

## Access & UX

- New **Notepad** item in `components/dashboard/UserMenu.tsx` under Personal Tools (NotebookPen icon). Clicking fires a `notepad:open` CustomEvent — same pattern as `timer:open-quick-start` and `feedback:open`.
- **Floating panel** anchored bottom-right, **~420px wide × ~470px tall**, `z-index` above page content, rendered by `NotepadPanel.tsx` mounted in `app/(dashboard)/layout.tsx`. Desktop-first (the UserMenu entry is desktop; panel also mounts fine if triggered elsewhere later).
- Panel has two views:

### List view
- Header: "Notepad" title, search icon (expands to inline search input filtering title + content), close ✕.
- "+ New note" button — creates a note titled with today's date (e.g. "July 22, 2026") and opens it in the editor view.
- Notes sorted by `updated_at` desc: title, one-line content snippet, relative time ("2h ago").
- Empty state: clipboard illustration (lucide `ClipboardList`), "Create personal notes" heading, short subline, "Create a note" primary button.
- Small "Archived" toggle at the bottom switches the list to archived notes (with Unarchive action per note).

### Editor view
- Header: back chevron (→ list view), inline-editable title (click to edit, Enter/blur to save), `⋯` menu, close ✕.
- `⋯` menu items: **Rename** (focus title), **Convert to Task**, **Archive** (or Unarchive), **Delete** (confirm dialog first).
- Rich text body below (see Editor).
- **Autosave**: debounced ~800ms after typing stops; subtle "Saved" indicator near the title. Also flush-save on close/back/unmount.

## Editor

- **Tiptap**: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item`, `@tiptap/extension-placeholder`, `@tiptap/extension-link`.
- Capabilities: bold, italic, strikethrough, H1–H3, bullet/numbered lists, checkboxes (task list), links, blockquote.
- Slim fixed toolbar at the top of the editor body (icon buttons, active-state highlight).
- Placeholder: "Write your note…".
- Content persisted as **HTML** in `content_html`.

## Convert to Task

- From the `⋯` menu. Opens `ConvertToTaskModal`:
  - Title (prefilled from note title), Client (optional select), Assignee (optional select), Priority (default normal).
  - Note body HTML is converted to plain text and used as the task description.
- Creates a real Task via existing `lib/supabase/tasks.ts` `createTask`, then stamps the note's `task_id`.
- A note with `task_id` shows a small "View task →" link in the editor header area (links to /tasks with the task focused, or plain /tasks if deep-link isn't supported).
- No completion sync back (same rule as Marketing Plan's Promote to Task).

## Data

### Migration `migrations/024_personal_notes.sql` (mirror into `schema.sql`)

```sql
create table personal_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  member_id uuid not null references organization_members(id) on delete cascade,
  title text not null default '',
  content_html text not null default '',
  task_id uuid references tasks(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index personal_notes_member_idx on personal_notes (member_id, updated_at desc);
```

- RLS: **personal-only** — org check via `organization_id IN (SELECT get_user_org_ids())` **AND** `member_id` = the caller's own member row. You see only your notes; Abel sees only his.
- Hard delete (no soft delete beyond `archived_at`, consistent with project convention).

### TypeScript

- `PersonalNote` interface in `lib/types.ts` (camelCase).
- `lib/supabase/personal-notes.ts`: `rowToNote` / `noteToRow` mappers, `listNotes({ archived })`, `createNote`, `updateNote`, `archiveNote`, `unarchiveNote`, `deleteNote`.

## Files

| File | Purpose |
|---|---|
| `migrations/024_personal_notes.sql` | table + RLS + index |
| `lib/supabase/personal-notes.ts` | CRUD + mappers |
| `lib/types.ts` | `PersonalNote` type |
| `components/notepad/NotepadPanel.tsx` | floating panel shell, open/close via `notepad:open` event, view switching |
| `components/notepad/NoteList.tsx` | list view + search + empty state + archived toggle |
| `components/notepad/NoteEditor.tsx` | title + Tiptap editor + autosave + ⋯ menu |
| `components/notepad/ConvertToTaskModal.tsx` | note → Task |
| `components/dashboard/UserMenu.tsx` | add Notepad menu item |
| `app/(dashboard)/layout.tsx` | mount NotepadPanel |

## Error handling

- Save failures: keep local state, show unobtrusive "Couldn't save — retrying" and retry on next debounce tick.
- Supabase client null (unauthenticated edge): panel renders nothing.
- Delete requires confirm; Convert to Task failure shows inline error in the modal, note untouched.

## Testing

- `npx tsc --noEmit` before push (project rule).
- Unit tests not required for v1 (UI-heavy); CRUD layer follows existing patterns already covered by convention.
- Manual verification in browser preview: create, edit/autosave, search, archive, delete, convert to task, RLS check (notes don't appear for other member).

## Out of scope (v1)

Daily-note button, client tagging, AI slash actions, sharing, print/export, mobile entry point, full-page expand.
