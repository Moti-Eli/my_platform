-- =============================================================================
-- Migration: Internal org chat — `messages` table + org-scoped RLS (PART 1)
-- =============================================================================
--
-- First step of the internal chat feature: the data model and its access rules.
-- Realtime delivery and UI come later (PART 2). This migration is pure data+RLS.
--
-- A message is org-scoped (like everything else in the platform): it belongs to
-- exactly one organization and is only ever visible to members of that org. The
-- access rules reuse our recursion-safe membership helper and add one chat-
-- specific guarantee — you can only ever post AS YOURSELF.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- messages — one row per chat message, scoped to an organization.
-- -----------------------------------------------------------------------------
-- `sender_id` references public.users (whose id mirrors auth.users.id), so it is
-- the same value auth.uid() returns — which is what the INSERT policy pins it to.
-- Messages are immutable for now: no UPDATE/DELETE policies exist (so those are
-- denied), and editing/deleting is a deliberate future feature.
-- -----------------------------------------------------------------------------
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sender_id       uuid not null references public.users (id) on delete cascade,
  content         text not null,
  created_at      timestamptz not null default now()
);

comment on table  public.messages                 is 'Internal org chat messages. Org-scoped; visible only to members of organization_id. Immutable for now (no update/delete policies).';
comment on column public.messages.organization_id is 'The organization this message belongs to. RLS keys on it for tenant isolation.';
comment on column public.messages.sender_id       is 'The author (public.users.id = auth.users.id). The INSERT policy pins this to auth.uid() so a sender cannot be forged.';
comment on column public.messages.content         is 'Message body (plain text, not null).';

-- Composite index for the common access pattern: fetch one org's messages in
-- chronological order ("load this org's chat history").
create index messages_org_created_idx on public.messages (organization_id, created_at);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation for reads, plus an anti-forgery rule for writes.
-- -----------------------------------------------------------------------------
-- RLS filters ROWS but does not grant TABLE privileges, so we also GRANT
-- SELECT + INSERT to `authenticated`; the policies below decide which rows they
-- may actually read/write. No UPDATE/DELETE grant and no UPDATE/DELETE policy =>
-- messages are immutable for normal users. `anon` gets nothing.
-- -----------------------------------------------------------------------------
alter table public.messages enable row level security;
grant select, insert on public.messages to authenticated;

-- SELECT — a user may read a message only if they are a member of its org. Uses
-- the recursion-safe SECURITY DEFINER helper (it bypasses RLS internally, so it
-- never re-enters this policy).
create policy "members can read their org's messages"
  on public.messages
  for select
  to authenticated
  using ( private.auth_user_is_member_of(organization_id) );

-- INSERT — a user may post a message only if BOTH:
--   (a) they are a member of the target organization, AND
--   (b) sender_id is THEMSELVES (sender_id = auth.uid()).
-- (b) is the critical anti-forgery rule: it makes it impossible to post a
-- message attributed to another user, even within your own org. WITH CHECK
-- validates the NEW row.
create policy "members can send messages as themselves"
  on public.messages
  for insert
  to authenticated
  with check (
    private.auth_user_is_member_of(organization_id)
    and sender_id = (select auth.uid())
  );

-- =============================================================================
-- UPDATE / DELETE are intentionally UNPOLICIED (therefore DENIED). Editing and
-- deleting messages is a future feature and will get its own reviewed policy.
-- Server-side code using the secret key (service_role) bypasses RLS as usual.
-- =============================================================================
