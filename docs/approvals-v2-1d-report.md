# Approvals v2 — PR 1D implementation report

Implemented locally on `approvals-v2-1d-comments`, using the existing 1A–1C engine and migration 132. No packages installed, remote services called, deployments, pushes, or commits performed by this agent. The existing `.agent/skills` deletion was left untouched. No prohibited directories or environment values were read or printed.

## Product rules and implementation

| Rule | Implementation |
| --- | --- |
| PAGE items only; SEO metadata remains read-only | `PagePreview.tsx` exposes block decoration only inside the page body and retains the 1C lock note. `comment-validation.ts`, `submit-route.ts`, and SQL reject invented/SEO anchors and unknown fields. |
| One-block highlights, cross-block snap, Unicode code points, quote/context/hash | `selection.ts` converts DOM UTF-16 positions to normalized code points and snaps at the first block. `carry.ts` builds anchors including section/block identity, hash, quote, offsets, prefix, and suffix. |
| Overlapping highlights | No range uniqueness restriction. `PageComments.tsx` paints all ranges with CSS Highlights and places separate numbered badges and margin markers. |
| Desktop floating Comment chip and Ctrl+Alt+M / Cmd+Option+M | `PageComments.tsx` positions the chip above the selection, handles the shortcut, and focuses the rail composer. |
| Mobile selection bar and bottom sheet | `page-review.css` uses the 768px breakpoint and a fixed 52px bar. `PageComments.tsx` provides the sheet, close/Escape behavior, and keyboard focus handling. |
| Pin mode and keyboard block comments | `PageComments.tsx` provides aria-pressed Add pin, Escape exit, whole-block and whole-mockup targeting, focusable blocks, and Comment on this section. No coordinates are stored. |
| On-page tokens and markers | `page-review.css` uses tint `#FCEFC7`, active `#F7DC8B`, underline `#8A5A00`, teal `#0E6670` pins, `#0B57D0` focus, and `#B35A00` changed-text borders. |
| Comments rail/sheet and filters | `PageComments.tsx` provides Your comments / Comments counts and All / Highlights / Pins / Images filters. |
| Local unsent comments, Edit/Delete, submission together | `PublicPageReview.tsx` persists drafts under a token-plus-version-set localStorage key, includes comments in Send, and clears storage after success. `PageComments.tsx` provides Edit/Delete. `submit-route.ts` validates and forwards comments to `submit_approval`; submission hashes include them. |
| Summary and confirmation counts | `PublicPageReview.tsx` shows Comments N and Image suggestions N on both screens. |
| Re-matching, without deleting or re-pointing originals | `carry.ts` implements exact identity/hash, quote within block, quote elsewhere in section/page, Moved, nearest surviving paragraph/block using the old outline, and Earlier comments. Mockup image hash changes are handled separately. `public.ts` and `detail.ts` compute carry on read. |
| Round 2 | `PageComments.tsx` shows Revision ready, Addressed in version N, Addressed for staged resolutions, Answered, Text changed since vN, Image changed, Moved, and Earlier comments. Public projection never exposes the next draft payload or its version number. |
| Agency comment handling | `AgencyComments.tsx`, mounted on `/approvals/[id]`, groups comments in page anchor order with quote/pin labels and author, Reply, Resolve, Reopen, optional-reply Decline, and Accept only for suggestions. `comment-routes.ts` authorizes session members, excludes bots, and scopes every comment to the request and organization. |
| Accept wording into next draft only | `apply-comment.ts` changes a copy of the current draft and preserves surrounding text formatting. `comment-routes.ts` submits its fresh outline with an expected-current-version guard. SQL moves only current_version_id and marks Addressed. The separate release route calls `release_approval_revision`. |
| Replace image on mockup and body images | `PageComments.tsx` places Replace image next to Pin, preserves the original, and shows Replacement suggested, thumbnail, Undo, and Change. A newer local suggestion replaces the older one; SQL supersedes the prior submitted pending suggestion. |
| Upload dialog, privacy, errors, cancellation | `ReplaceImage.tsx` provides Browse plus drop zone, camera/library-compatible accept types, 15 MB/type checks, role=alert errors, XHR upload percentage and Cancel, Current/Your suggestion, optional note, privacy copy, and disabled Save until conversion completes. No crop or client alt-text field. |
| Server byte validation and HEIC/HEIF conversion | `replacement-images.ts` checks JPEG/PNG/WebP/HEIC/HEIF signatures and size, decodes with sharp, and dynamically loads heic-convert. HEIC decoding runs in a worker with a 15-second timeout and 256 MB JS heap limit; sharp has a 40-megapixel input limit and 15-second timeout. `image-upload.ts` stores a private `.preview.jpg` and calls `set_approval_upload_preview`. |
| Converted previews everywhere; agency-only original download | `public.ts` and `detail.ts` sign converted copies for accepted images and pending suggestions. `comment-routes.ts` provides a scoped, five-minute original download only to staff. `next.config.ts` keeps heic-convert external; the successful build trace includes heic-convert, heic-decode, and libheif-js. |
| Agency image decisions | `AgencyComments.tsx` shows Current/Suggested, client note, Accept/Decline/Download original, Addressed/Reopen, and the Check alt text for the new image prompt. Acceptance changes only the next draft. |
| Route security | New public routes use token and released-version SQL gates, existing rate limits, no-store/noindex headers, and reservation link/request/item/version/purpose/status/expiry checks. Staff routes use agencyActor and membership/role checks; bots are forbidden. |

## SQL changes

Both `migrations/132_approvals_v2.sql` and its `schema.sql` mirror were updated; no migration was applied.

- Added an overload of `accept_approval_suggestion` accepting a fresh outline and expected current version. This is needed because copying the old outline after accepting wording would leave stale hashes and lengths. The original signature remains available. The existing grant loop revokes public/anon/authenticated execution and grants only service_role for both overloads.
- Image attachment now also requires a verified reservation, its matching link, and a completed preview. Existing migration image fixtures now model this completed-upload contract.

## Files changed

Paths below are relative to the repository. Files already added in the workspace's intermediate checkpoint commits are included.

- `components/approvals-v2/`: `PageComments.tsx`, `ReplaceImage.tsx`, `AgencyComments.tsx`, `PagePreview.tsx`, `PublicPageReview.tsx`, `page-review.css`.
- `app/(dashboard)/approvals/[id]/page.tsx`.
- `app/api/approval-requests/[id]/comments/[commentId]/route.ts` and `release/route.ts`.
- `app/api/public/approvals/[token]/image-upload/route.ts` and `[reservationId]/complete/route.ts`.
- `lib/approvals-v2/`: `carry.ts`, `selection.ts`, `comment-validation.ts`, `comment-row.ts`, `apply-comment.ts`, `comment-routes.ts`, `image-upload.ts`, `replacement-images.ts`, `public.ts`, `detail.ts`, `staff.ts`.
- Tests in `lib/approvals-v2/`: `carry.test.ts`, `selection.test.ts`, `comments-db.test.ts`, `comments-routes.test.ts`, `replacement-images.test.ts`, `migration.test.ts`, `page-routes.test.ts`.
- `lib/gbp-approvals/submit-route.ts` and `public-view.ts`.
- `migrations/132_approvals_v2.sql`, `schema.sql`, `next.config.ts`, and this report.

## Validation and limits

- `npm run typecheck`: passed.
- `npm run lint`: zero errors; repository warnings remain.
- `npm test`: full runner passed, including PGlite tests. Node's aggregate runner reports test files as tests; the HEIC fixture skip is visible when its test file runs directly.
- `git diff --check`: passed.
- `npm run build`: passed offline with dummy Supabase values, a temporary Next Google-font response fixture, and a preload blocking network access. The temporary diagnostic configuration ran webpack in-process; no production font configuration was changed.
- HEIC conversion test is explicitly skipped when the offline sharp/libvips build cannot encode HEVC. No fixture was downloaded. JPEG conversion, signature checks, type/size mismatch, and forged image rejection are tested.
- No live Supabase/storage integration or real-browser/device interaction testing was performed, consistent with the no-network constraint. Those remain verification work; no known product feature has intentionally been deferred.
