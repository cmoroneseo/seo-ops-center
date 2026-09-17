# Prompt: Content Approval Portal

> Paste as the opening prompt for a fresh session on a new feature branch.
> The architecture is decided — see **Decisions locked**. Don't relitigate them.

---

## Objective

Build a **Content Approval Portal** in `seo-ops-center`. SEO content is drafted in Google
Docs, imported into the app once, sent to the client as a single tokenized link, and
reviewed in a Google-Docs-grade reader with Figma-style comment threads and inline
suggestions. Each document in a batch is approved independently.

Approval writes back to the existing `deliverables` record (`status: 'Review' → 'Approved'`)
so the fulfillment matrix, KPI strip, and AtRiskRail stay truthful. A portal that doesn't
close that loop is a toy.

## Decisions locked

1. **Import-once. The handoff to client review is a one-way door.** Writers draft in Google
   Docs. On import, the app becomes the source of truth for that document; the Doc is
   archival. All post-handoff revisions happen in the app. This is what keeps comment
   anchoring tractable — see §3.
2. **Import via the Google Docs API from a document link.** Not clipboard paste, not
   `.docx`. See §1.
3. **Comments and suggestions are custom-built** on open-source Tiptap/ProseMirror.
   No Tiptap Pro.
4. **One share link per batch**, with a lightweight name prompt on first open for
   attribution. No client contacts table, no client accounts. The link is pasted into the
   client's Basecamp project by hand (auto-creating that card is a later feature — §7).
5. **A document is either open for review or open for editing, never both.** This single
   invariant is what prevents the client's comments and the writer's edits from diverging.

## Hard constraints (this repo)

- Next.js 15 App Router, React 19, TS strict, Tailwind v4, Radix/shadcn, lucide-react.
- Supabase + RLS. Org-scoped tables use `organization_id in (select get_user_org_ids())`.
- snake_case DB → camelCase TS via `rowToX` / `xToRow` in `lib/supabase/*.ts`.
- Enums = text CHECK constraints in PG, string unions in TS (`lib/types.ts`).
- Numbered migrations from `migrations/057_*.sql`, mirrored into `schema.sql`. Never edit
  an applied migration in place — supersede it.
- Pure domain logic in `lib/approvals/*.ts` with `node:test` tests. Run `npm test`.
- Feature branch off `main`. `npx tsc --noEmit` before pushing. No `Co-Authored-By` lines.
- **Reuse what exists.** Tiptap v3 (`@tiptap/react`, `starter-kit`, `link`, `placeholder`,
  `task-list/item`) is already a dependency and styled — see `components/notepad/NoteEditor.tsx`
  and `.notepad-editor` in `app/globals.css`. Resend is wired. Supabase Storage patterns
  exist (`campaign-screenshots`). `@anthropic-ai/sdk` is installed with `ANTHROPIC_API_KEY`
  on Vercel, and there are seven existing AI route handlers to copy the shape from
  (`app/api/campaign/draft-overview`, `app/api/marketing-plan/suggest-items`, …).
  Do not add a second editor, email provider, or AI SDK.
- `@tiptap/extension-table` and `@tiptap/extension-image` are **not** installed — add them.

---

## 1. Google Docs import (runs once per document)

### Why the API and not clipboard paste

Verified against the canonical fixture — a Kentina Group service page,
`1_tKQhG3G7oy1HC35wUzaG7T0fRtaoAPCot8tcFlTRfU`, now checked in at
`lib/approvals/__fixtures__/kentina-service-page.json` and asserted on in
`lib/approvals/gdocs-to-tiptap.test.ts`:

- Clipboard HTML loses structure the API preserves cleanly, and the API gives
  **`revisionId`** — which powers the post-handoff drift guard (§1, last item).
- Import happens once per document, so fidelity at that moment is worth paying for.
  Anything the converter gets wrong is fixed by hand in the app minutes later.

### Auth: service account, not per-user OAuth

Use a **Google service account** with Docs + Drive read scopes. Share the team's content
folder in Drive with the service account's email once; every doc inside inherits access.
No consent screen, no per-user token refresh. If the docs live in a Shared Drive, add the
service account as a member of that drive. Credentials JSON goes in a Vercel env var.

### Converter: Docs JSON → Tiptap JSON

`lib/approvals/gdocs-to-tiptap.ts`, pure and tested. Known shape from the fixture:

- **Headings** — `paragraph.paragraphStyle.namedStyleType`: `TITLE`, `SUBTITLE`,
  `HEADING_1` … `HEADING_6`. Support all six. The fixture uses **H1–H4** (22 headings:
  one H1, then H2–H4) — the original brief said H1–H3, which would flatten every H4 in it.
- **Marks** — `textRun.textStyle`: `bold`, `italic`, `underline`, `strikethrough`,
  `baselineOffset` (super/subscript), `link.url`. The fixture exercises bold (46),
  underline (11) and links (20); italic and strikethrough appear only in Google's
  document-level style *definitions*, never in the body, so test those synthetically.
- **Lists are the trap.** Google stores no list nodes — just *flat paragraphs* each
  carrying `bullet.listId` (+ `bullet.nestingLevel`, **omitted entirely when 0**). Fold
  consecutive paragraphs sharing a `listId` into one nested tree. Ordered-vs-bulleted is
  not on the paragraph: read top-level `lists[listId].listProperties.nestingLevels[n]` —
  `glyphType` means ordered, `glyphSymbol` means bulleted. The fixture has 21 bulleted
  paragraphs folding into **4 flat lists** — no nesting, nothing ordered — so a naive
  converter passes the fixture and then breaks on the first nested or numbered list in a
  real blog. Cover both synthetically.
- **Tables** — `table.tableRows[].tableCells[]`, each cell holding its own paragraphs.
  Row 0 is a header row. The fixture has **two tables** — a 6×3 venue comparison
  (header + 5 attribute rows) and a second 4×3.
- **Images** — `inlineObjectElement` → top-level `inlineObjects[]`. The `contentUri` is
  **short-lived**: download bytes at import, re-host in a new Supabase Storage bucket
  (`approval-content`), rewrite the src. Carry alt text through — it's an SEO requirement.
  (The fixture has none; blogs will.)
- Plus `horizontalRule`, `sectionBreak`, and embedded video URLs.

### The `suggestionsViewMode` trap (two traps, actually)

`documents.get` defaults to `SUGGESTIONS_INLINE` — the fixture came back exactly that way.
Import with the default and **pending, un-accepted Google Docs suggestions get folded into
the content you send the client.** So always pass the mode explicitly.

The second trap only shows up against a real read-only grant, which is how this is
actually deployed. **Verified live:** with the service account holding Viewer,

| mode | reader | writer |
|---|---|---|
| *(omitted)* | 200 | 200 |
| `DEFAULT_FOR_CURRENT_ACCESS` | 200 | 200 |
| `SUGGESTIONS_INLINE` | **403** | 200 |
| `PREVIEW_SUGGESTIONS_ACCEPTED` | **403** | 200 |
| `PREVIEW_WITHOUT_SUGGESTIONS` | 200 | 200 |

The 403 reads *"You do not have permission to access the document suggestions."* So the
appealing design — request `SUGGESTIONS_INLINE` once, use it for both the content and the
pending-suggestion check — quietly requires **write access on every client document just
to read it**. Not a trade worth making.

Use `PREVIEW_WITHOUT_SUGGESTIONS` for the content: it is the only mode that both excludes
un-accepted suggested text and works read-only. Then probe separately with
`SUGGESTIONS_INLINE` and treat a 403 as **unknown, not an error** — the content is already
safe, and all that is lost is the ability to warn that the writer left suggestions
unresolved. When the probe does succeed and finds pending suggestions, refuse the import.

Ignore native Google Docs comments; this portal replaces them.

### Import UX and the drift guard

Internal user pastes a Doc URL (or picks from the shared Drive folder) → fetch → convert →
preview → commit as the document's working draft. Store `gdoc_document_id` and
`gdoc_revision_id`.

Because the Doc is archival after handoff, add a **drift guard** to the existing daily
Vercel Cron (Hobby plan is daily-only): if the source Doc's `revisionId` has changed since
import, flag it — "someone edited the Google Doc after handoff; those changes are not in
the portal." This catches the single most likely way the one-way door gets violated.

### Export

Print → PDF (reuse report-builder print CSS), copy clean HTML, copy Markdown, and a
"copy for WordPress/Webflow" mode stripping editor-only attributes.

---

## 2. Batches, documents, versions, approval state

- A **batch** = one client-facing package: "October Content — Kentina", containing N
  documents ("Blog #1", "Blog #2", "Temecula Service Page").
- Each document has **its own approval decision**. The batch completes only when every
  document resolves. Per-doc status in a left rail, batch progress bar above it.
- Decisions: `pending` → `approved` | `approved_with_edits` | `changes_requested`.
  `approved_with_edits` is required — clients routinely say "fine, just fix the two
  comments," and a binary forces a fake extra round-trip.

### The working draft / published version split

- `content_approval_docs.working_json` is the **live editable document**. Only internal
  users touch it.
- `content_doc_versions` are **immutable snapshots**, cut when a document is sent for
  review or when a revision round is published.
- **The client only ever sees the latest published version**, never the working draft.
  Without this, a client refreshes mid-edit and reads half-finished prose.
- **The review lock (decision #5):** while a review round is open, the working draft is
  frozen — the editor is read-only internally, with a visible "under client review" banner.
  Closing the round (or explicitly reopening for edits) unlocks it. You do not edit while
  the client is reading, and the app enforces that rather than trusting discipline.
- Approval is stamped against a `version_id`, so approving v1 can never silently cover v3.
  Diff view between any two versions.
- Link each document to `deliverables.id`. On approval, write the deliverable to
  `'Approved'` and append a `status_history` entry. Unresolved `changes_requested` threads
  promote to real Tasks — mirror the `ConvertToTaskModal` / marketing-plan "Promote to
  Task" pattern (create Task, stamp `task_id`, no sync back).

### Closing the month's commitment — already solved, do not build it

An approved batch must close the month's commitment, and **it already does** once the
deliverable flips. `lib/supabase/fulfillment.ts:7` defines
`DELIVERED_STATUSES = ['Approved', 'Published']`, and `getFulfillmentMatrix` counts those
against the commitment's promised total, computed on read.

So: **add no `commitment_closed` column, no stored rollup, no trigger.** Writing the
deliverable to `'Approved'` is the entire mechanism. A stored flag would violate the
compute-on-read convention and create a second, drifting source of truth.

Three consequences to honour:

- **A document with no linked deliverable closes nothing.** The batch builder must require
  a deliverable per document — either pick an existing one or create it inline. A batch
  where documents are unlinked is silently invisible to fulfillment.
- **The deliverable's `month` field buckets it, not the approval date.** An October blog
  approved on Nov 3rd closes October. Don't re-stamp `month` on approval.
- **`approved_with_edits` also flips the deliverable to `'Approved'`.** The client has
  signed off; the outstanding edits become Tasks. Holding it back would under-report work
  the client already considers delivered. (Judgment call — change it if you disagree, but
  make it deliberately.)
- Per-document SEO metadata panel: target keyword, meta title (pixel + char counter), meta
  description, URL slug, word count, internal-link targets. Clients approve metadata too.
  The fixture Doc carries none of this — it lives in the app, not the Doc.

---

## 3. Comments and suggestions

### Architecture: overlays, not marks in the document

**Do not write comment or suggestion marks into the document JSON.** Keep them as external
anchored records rendered at display time as ProseMirror `Decoration.inline`. No document
mutation, no mark-vs-import conflicts, read-only rendering everywhere, and suggestions that
are structurally incapable of corrupting the base content. This is what makes the custom
build tractable.

### Anchoring

The review lock makes this a solved problem rather than a research project:

- Client comments arrive against a **frozen** published version. The writer then unlocks
  and edits from that exact base, so comments carry forward through
  `tr.mapping` on each transaction — standard ProseMirror, no fuzzy matching.
- Persist `{ from, to, quotedText, prefix, suffix, versionId }`. `from`/`to` are the live
  anchor; the text fields are the repair kit.
- **Never delete a comment because its anchor moved.** If the anchored text is deleted
  outright, mark the comment **`orphaned`**, keep the quoted text, and surface it in the
  sidebar as "couldn't re-attach — was on: *…*". Silently losing client feedback is the
  worst failure mode this feature has.

**Structural rewrites — archive and replace, not re-import.** If a writer needs a rewrite
too large for the in-app editor, they archive the document and add a freshly-imported one
to the batch. The old document and its threads stay readable as history; the new one starts
clean.

This is deliberate. Re-importing *over* a document breaks position continuity and would
force a content-based fuzzy re-anchor (quoted text + context window + occurrence index,
with a similarity threshold to tune) — which is precisely the hard, failure-prone algorithm
the import-once architecture exists to avoid. Building it in v1 would pay that cost anyway,
on speculation, for a path that may never be used: after a structural rewrite, most v1
feedback is obsolete regardless. Archive-and-replace is honest about what's happening,
costs almost nothing (it is "add document" plus "archive document"), and covers the real
need.

So **v1 `lib/approvals/anchoring.ts` needs only position mapping and orphan handling — no
fuzzy matcher.** Revisit only if real usage shows writers doing this often enough that
losing thread continuity actually hurts.

### Threads

- Select any range — word, sentence, paragraph, across nodes, a table cell, an image — and
  comment. Highlight inline; hover surfaces the thread, click focuses it in a right sidebar.
- Threaded replies, `@mention` of internal members (fires the existing notification bell),
  resolve / re-open, edit and delete own comments.
- Sidebar filters: open / resolved / mine / by document / by reviewer. Sort by doc position.
- Overlapping and nested highlights must stay legible — stacked underlines or tint
  intensity, not an opaque block that hides the text.

### Suggestions

The client can't edit, so a suggestion is a **proposed patch**: select a range → "Suggest
edit" → type the replacement. Stored as `{ anchor, kind: 'insert'|'delete'|'replace',
payload }` and rendered as strike-through + insertion decorations.

Because the app owns the document, **accepting actually applies the change** to the working
draft on unlock — real accept/reject, like Google's, with no manual changelist and no
write-back-to-Docs problem. Statuses: `pending → accepted | rejected`, with
`applied_in_version_id` recorded when the resulting version is published.

---

## 4. The share link

- Route: `app/(portal)/review/[token]/page.tsx` — **outside** the `(dashboard)` segment and
  explicitly allowlisted in `middleware.ts`, which currently redirects all unauthenticated
  traffic to `/login` (middleware.ts:84-95). Miss this and every link 302s to a login screen.
- One token per batch. Store a **SHA-256 hash**, never the token; show the full URL once,
  with a copy button (it gets pasted into Basecamp by hand).
- Controls: expiry (default 30 days), revoke, regenerate, view-only vs comment-enabled.
- **Attribution:** on first open, one field — "Who's reviewing?" (name, optional email).
  Persist to the link's reviewer list and to `localStorage` so it's asked once per person.
  Not a login, not a gate; a label. Multiple named reviewers per link is expected and fine.
- All portal reads/writes go through route handlers using the **service-role client**, with
  the token as the authorization check. Never expose the anon client to portal routes. A
  token grants exactly one batch and nothing else.
- `noindex, nofollow` meta + `X-Robots-Tag` header. Rate-limit comment POSTs.
- Track `first_viewed_at` / `last_viewed_at` and per-reviewer first-seen.

---

## 5. Notifications

- Send-for-review email via Resend as an option, themed with the org brand colour
  (`lib/email/templates.ts` resolves the gradient to literal hex). But the primary delivery
  path is **copy link → paste into Basecamp**, so the copy affordance must be first-class.
- Internal notifications: link first opened, new client comment, doc approved, changes
  requested, batch fully approved, source Doc drifted after import.
- Append-only activity trail per batch — who sent it, who viewed when, every state
  transition with actor and timestamp. Same spirit as `status_history`.

## 6. Client UX

- **Neutral document styling, not a rendered page preview.** The reader uses clean,
  readable document typography — not the client's site fonts and CSS. Reviewers read
  better in a document, per-client style replication is unbounded work, and a half-accurate
  page mock invites "the button is the wrong blue" feedback on content you're asking them
  to approve for *copy*. A "preview as published" toggle is a later addition if it earns
  itself.
- **Must work on mobile and tablet** — clients review on phones. Sidebar becomes a bottom
  sheet; text-selection → comment must work with touch handles.
- Zero-login. No account creation, no Supabase auth for clients.
- Keyboard accessible, screen-reader sane, visible focus, AA contrast. Use themed tokens;
  never hardcode brand colours.
- Draft comments autosave to `localStorage` (wrapped in try/catch) so a closed tab doesn't
  eat a half-typed paragraph.
- Designed states for: empty, loading, expired link, revoked link, already approved,
  superseded by a newer version.

## 7. Basecamp card (later, not in this build)

Leave a seam for it. The integration already exists — per-client project config, to-do
push, and a per-task todolist override (`lib/supabase/tasks.ts`, IntegrationsTab). A later
feature creates a to-do in the client's Basecamp project carrying the review link and the
document list. **Gotcha for whoever builds it:** a todolist must already exist in the
project — to-do push creates the to-do, not the list.

---

## 8. "Fix with AI" (Phase 2 — evaluated below, do not build first)

**Verdict: yes, build it — it's the highest-leverage add-on here — but not as described.**

It fits unusually well for a structural reason: every comment is *already anchored to a
specific text range*. So the model gets (selected text, the client's comment, surrounding
paragraphs, target keyword) — a tight, well-scoped rewrite task, which is the kind LLMs are
actually reliable at. And the output doesn't need new UI: it becomes a **suggestion** in the
existing accept/reject rail. The feature is nearly free once §3 exists, and close to
worthless before it. That ordering is load-bearing.

The real value isn't the hard feedback — it's that a three-blog batch comes back with 20
comments and 14 of them state exactly what to change. Clearing those in one pass is the win.

**Three changes to the design as described:**

1. **Classify before generating.** Sort every comment into **direct** (states the exact
   change: "change 'wine tasting' to 'wine experience'", "it's *their*, not *there*", "our
   tagline is X") or **open** (expresses a reaction: "too salesy", "this doesn't land").
   A direct comment is a deterministic find-and-replace **within the anchored range** — no
   model call, instant, zero risk. Only open comments go to the model. A cheap
   classification pass decides the bucket.
2. **For vague feedback, generate three variants, not one rewrite.** "I don't like the way
   this sounds" carries no direction — a single guess is a coin flip, and a wrong guess
   costs more time than writing it yourself. Offer e.g. tighter / warmer / more concrete
   and let the human pick a direction. Consider also letting the model **reply in the
   thread asking the client what specifically is off** — often the better move than guessing.
3. **Never auto-apply.** Every AI output lands as a pending suggestion with a visible diff.
   A human accepts it. No exceptions.

**SEO guardrails — non-negotiable, this is SEO content:**

- Preserve the target keyword's presence in the range unless the comment is about it.
- Never alter headings unless the comment is anchored to a heading.
- Preserve all links (href *and* anchor text) unless the comment is about a link.
- Respect approximate word count; flag when a rewrite changes it materially.
- Show a word-level diff always. Pass surrounding paragraphs as style context so the
  rewrite doesn't flatten the client's voice into generic marketing prose.

**Also worth building:** **"Apply Quick Fixes"** — a batch action that turns every `direct`
comment into a suggestion in one pass. Single-comment equivalent: **"Apply as written"**,
which says exactly what happens — the client wrote the change, the app applies it verbatim.

Route handler: `app/api/approvals/fix-with-ai/route.ts`, following the shape of the
existing seven AI routes.

---

## Suggested data model

```
content_approval_batches   id, organization_id, client_id, name, status, due_date,
                           created_by, sent_at, completed_at, created_at
content_approval_docs      id, batch_id, organization_id, deliverable_id (nullable),
                           title, subtype, position, working_json jsonb,
                           current_version_id, review_locked bool, status,
                           decided_at, decided_by_label, seo_meta jsonb,
                           gdoc_document_id, gdoc_revision_id
content_doc_versions       id, doc_id, version_no, content_json jsonb, content_html text,
                           word_count, published_by, created_at          -- immutable
content_comments           id, doc_id, version_id, thread_root_id (self FK), parent_id,
                           author_type ('internal'|'client'), author_user_id,
                           author_label, body, anchor jsonb,
                           status ('open'|'resolved'|'orphaned'),
                           resolved_by, resolved_at, task_id, created_at
content_suggestions        id, doc_id, version_id, kind ('insert'|'delete'|'replace'),
                           anchor jsonb, payload text, origin ('client'|'ai'),
                           author_label, status ('pending'|'accepted'|'rejected'),
                           decided_by, decided_at, applied_in_version_id
content_share_links        id, batch_id, organization_id, token_hash, expires_at,
                           revoked_at, allow_comments bool, first_viewed_at,
                           last_viewed_at, created_by
content_share_reviewers    id, share_link_id, name, email, first_seen_at
```

`anchor` jsonb = `{ from, to, quotedText, prefix, suffix }`.

RLS: standard `get_user_org_ids()` policy on all of them. Portal access never uses
RLS-as-the-client — service-role behind token verification in a route handler.

Pure, tested modules in `lib/approvals/`: `gdocs-to-tiptap.ts`, `anchoring.ts`,
`batch-status.ts`, `token.ts`.

## Build order

1. Migration + types + CRUD + `lib/approvals/*` with tests.
2. Google service account + Docs API fetch + converter. **Verify against the Kentina
   fixture first** — 22 headings across H1–H4, both tables, 4 lists / 21 items, 20 links,
   the horizontal rule, bold and underline — then synthetically for what the fixture does
   not contain: nested lists, ordered lists, images, italic, strikethrough.
3. Internal document view: full node/mark rendering, working draft, version publish, diff.
4. Batch builder + share link + `middleware.ts` allowlist + public portal route.
5. Comment threads, decoration rendering, `tr.mapping` continuity, orphan handling.
6. Suggestions + accept/reject applying to the working draft.
7. Approval decisions, review lock, deliverable write-back, Task promotion.
8. Notifications, drift guard cron, activity trail.
9. Mobile pass, a11y pass, export/print.
10. *(Phase 2)* Fix with AI, per §8.

Ship 1–5 as one branch, 6–9 as a second. Never more than ~2 branches on this subsystem.

## Acceptance criteria

- The Kentina doc imports by URL with all 22 headings (H1–H4), both tables, 4 lists of
  21 items, 20 links, and the horizontal rule intact — verified side by side against the Doc.
- A doc with pending Google Docs suggestions refuses to import, with a clear message.
- A doc with nested bullets produces correctly nested lists, and an ordered list imports as
  `orderedList` (read from `lists[listId]`, not guessed).
- Images are re-hosted in Supabase Storage with alt text preserved; no expired `contentUri`
  ever reaches the client.
- Sending a doc for review locks the working draft; the editor is read-only with a visible
  banner until the round closes.
- The client never sees an unpublished working draft.
- A batch of two blogs + one service page sends as one link; approving Blog #1 leaves the
  others `pending` and the batch open.
- A comment on v1 still points at the right sentence after the writer inserts paragraphs
  above it — and becomes `orphaned` with quoted text preserved, never deleted, when that
  sentence is removed.
- Accepting a client suggestion applies it to the working draft and shows in the v2 diff.
- A document can be archived and replaced by a fresh import within the same batch, with
  the archived document and its threads still readable.
- Editing the source Google Doc after handoff raises a drift flag within a day.
- Expired and revoked links render clean states and leak nothing about the batch.
- Approval flips the linked `deliverables` row to `'Approved'` with a `status_history`
  entry, and the client's fulfillment matrix shows that month's commitment satisfied —
  with no new stored column anywhere.
- A document cannot be added to a batch without a linked deliverable.
- `npm test` passes; `npx tsc --noEmit` clean; usable one-handed on a phone.

## Deployment prerequisites — none of this runs until these are done

1. **Apply migration `057_content_approval_portal.sql`** in the Supabase SQL editor.
   Nothing works before this; the portal resolves every link to "not found" because the
   tables do not exist. Note the sandbox tenant shares the production database, so it
   will not rehearse this migration for you.
2. **Create the `approval-content` Storage bucket** — public, image types, alongside
   `client-logos` and `campaign-screenshots`. Imported Doc images are re-hosted here.
3. **Create a Google service account**, download its credentials JSON, and set
   `GOOGLE_SERVICE_ACCOUNT_JSON` on Vercel to the whole JSON string.
4. **Share the Drive content folder** with that service account's email address. For a
   Shared Drive, add the service account as a member of the drive instead.

Verify with: import the Kentina doc into a batch, publish it, mint a link, open it in a
private window.

## Explicitly deferred (do not build in v1)

Each of these is a real feature with a real reason to wait. Don't let scope creep pull them
forward, and don't design v1 around them either.

1. **Fix with AI** (§8) — worthless before comments and suggestions exist; nearly free after.
2. **Basecamp card creation** (§7) — the link is pasted by hand in v1. Leave the seam.
3. **Content-based fuzzy re-anchoring** — superseded by archive-and-replace (§3). Revisit
   only if writers hit it often enough that losing thread continuity actually hurts.
4. **"Preview as published" styling toggle** (§6) — neutral document styling is the v1
   answer, and likely the permanent one.
5. **Client accounts / per-contact links** — a name prompt covers attribution (§4). Build a
   contacts model when something other than this feature needs one.
