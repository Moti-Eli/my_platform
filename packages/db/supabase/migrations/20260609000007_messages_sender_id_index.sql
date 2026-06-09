-- =============================================================================
-- Migration: Covering index for messages.sender_id foreign key
-- =============================================================================
--
-- The performance advisor flags `messages_sender_id_fkey` (messages.sender_id ->
-- users.id) as lacking a covering index, so deleting a user would seq-scan
-- `messages`. Add the covering index. (The org-ordered read path is already
-- served by messages_org_created_idx (organization_id, created_at).)
-- =============================================================================

create index if not exists messages_sender_id_idx on public.messages (sender_id);
