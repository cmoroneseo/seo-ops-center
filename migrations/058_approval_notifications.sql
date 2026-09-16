-- 058_approval_notifications.sql
-- Notification types and entity types for the Content Approval Portal.
--
-- Both columns are text with a CHECK constraint (the project convention — enums stay
-- out of Postgres so a new value never needs an ALTER TYPE), so widening them means
-- dropping and recreating the constraint rather than adding a value.

alter table public.notifications
    drop constraint if exists notifications_type_check;

alter table public.notifications
    add constraint notifications_type_check check (type in (
        'task_assigned',
        'task_mentioned',
        'note_mentioned',
        'deliverable_assigned',
        'deliverable_overdue',
        'deliverable_at_risk',
        'deliverable_status',
        'reminder_due',
        -- Content Approval Portal
        'approval_opened',       -- the client opened the review link for the first time
        'approval_comment',      -- a client left a comment or suggested an edit
        'approval_decision',     -- a document was approved / changes were requested
        'approval_batch_done',   -- every document in a batch has been accepted
        'approval_doc_drifted'   -- the source Google Doc changed after the handoff
    ));

alter table public.notifications
    drop constraint if exists notifications_entity_type_check;

alter table public.notifications
    add constraint notifications_entity_type_check check (entity_type in (
        'task',
        'task_comment',
        'client_note',
        'deliverable',
        'reminder',
        'content_approval_batch',
        'content_approval_doc'
    ));
