-- Client-wide notes and team replies. Existing portal RLS and service-role-only
-- writes remain unchanged. General threads are scoped to the contact's client.
alter table public.client_portal_feedback
    drop constraint client_portal_feedback_subject_type_check,
    add constraint client_portal_feedback_subject_type_check
        check (subject_type in ('plan', 'waiting_item', 'general')),
    alter column contact_id drop not null,
    add column staff_user_id uuid references public.users(id) on delete cascade,
    add constraint client_portal_feedback_author_check
        check ((contact_id is not null) <> (staff_user_id is not null)),
    add constraint client_portal_feedback_general_scope_check
        check (subject_type <> 'general' or subject_id = client_id);

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
    'task_assigned', 'task_mentioned', 'note_mentioned',
    'deliverable_assigned', 'deliverable_overdue', 'deliverable_at_risk', 'deliverable_status',
    'reminder_due', 'approval_opened', 'approval_comment', 'approval_decision',
    'approval_batch_done', 'approval_doc_drifted', 'portal_feedback'
));
alter table public.notifications drop constraint if exists notifications_entity_type_check;
alter table public.notifications add constraint notifications_entity_type_check check (entity_type in (
    'task', 'task_comment', 'client_note', 'deliverable', 'reminder',
    'content_approval_batch', 'content_approval_doc', 'client_portal_feedback'
));
