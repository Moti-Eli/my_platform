-- =============================================================================
-- Migration: The Cortex `candidate_answers` tool table
-- =============================================================================
--
-- Structure follows the tool-table template (time_entries, 20260723000004): an
-- org-scoped, visibility-bearing table, read via `private.auth_user_can_read`,
-- written via `private.auth_user_can_write`, with the reusable immutability
-- trigger attached from birth. Nothing about the SECURITY MODEL is novel — and
-- that is the point of this header: the novelty is entirely in WHERE the rows
-- live, and the security falls out of that geography.
--
-- -----------------------------------------------------------------------------
-- WHERE THESE ROWS LIVE — AND WHY GEOGRAPHY DOES THE SECURITY WORK
-- -----------------------------------------------------------------------------
-- A candidate answers a questionnaire at invite time. Each answer is one row
-- here, and it lives in the CANDIDATE'S OWN CHILD ORG:
--
--     org_id   = the candidate's child org (a leaf org under the recruiting
--                parent — in this architecture that child org hosts EXACTLY ONE
--                candidate).
--     owner_id = the candidate USER (a member of that child org who can log in).
--
-- There is NO candidate-specific policy, and none is added. The ordinary org-tree
-- rules already say exactly the right thing, because of where the rows sit:
--
--   * The candidate reads and writes THEIR OWN answers as a plain member of their
--     OWN child org — `visibility = 'org'` + membership in the row's org tree.
--   * Recruiters in the PARENT org read (and, per the platform's tree-WRITE rule,
--     may also write) the candidate's answers by INHERITANCE DOWNWARD — a member
--     of an ancestor org is a member of the tree of any descendant. This is the
--     same rule inventory/notes/time_entries rely on; it is not loosened here.
--   * A SIBLING child org (another candidate) sees NOTHING: inheritance flows down
--     only, never sideways, so one candidate can never read another's answers.
--   * Losing membership loses access, by construction (membership is the blocking
--     AND inside auth_user_can_read/can_write — never an OR branch).
--
-- The parent-org WRITE reach is deliberate and stated plainly: the tree-write rule
-- as it stands lets any member of an ancestor org write a descendant's 'org' rows.
-- A recruiter correcting/annotating a candidate's answer is exactly that reach in
-- use. If answers should ever become recruiter-read-but-not-write, that is a
-- can_write change reviewed on its own (the same asymmetry time_entries documents
-- for admins), NOT a policy tweak here.
--
-- -----------------------------------------------------------------------------
-- SELECT USES auth_user_can_read — NOT the older 'org'-only shape
-- -----------------------------------------------------------------------------
-- `candidates` itself still carries the legacy SELECT shape
-- (`is_member_of_tree(org_id) AND visibility = 'org'`). This table deliberately
-- does NOT: it wires the modern full read path `private.auth_user_can_read`
-- (20260716000005, admin-read extension 20260723000003), so that if a future
-- answer row is ever born 'private' or 'restricted' it is handled correctly
-- rather than silently invisible. Today every row defaults to 'org'; the default
-- is the fail-safe, and the full read path is the forward-compatible choice.
--
-- -----------------------------------------------------------------------------
-- question_text IS A DENORMALIZED SNAPSHOT — ON PURPOSE
-- -----------------------------------------------------------------------------
-- `question_key` identifies the question; `question_text` is a COPY of the
-- question exactly as it was asked at invite time. The question bank lives in
-- TOOL CODE, not the database. Editing the bank later (rewording, reordering)
-- must NOT retroactively rewrite what a candidate was actually asked — an answer
-- is only meaningful next to the question it answered. So the text is frozen into
-- the row at creation and never looked up. This duplication is intended, like
-- record_grants' denormalized org_id: a snapshot of a value owned elsewhere.
--
-- -----------------------------------------------------------------------------
-- unique (org_id, question_key) — ONE ANSWER PER QUESTION PER ORG
-- -----------------------------------------------------------------------------
-- A question is answered at most once per org. Because a candidate's child org
-- hosts exactly one candidate, this same constraint also blocks DOUBLE-
-- MATERIALIZATION at the DB level: re-running the invite/materialization for a
-- candidate cannot create a second copy of the same answer row — the second
-- insert fails on the unique constraint instead of silently duplicating.
--
-- -----------------------------------------------------------------------------
-- IMMUTABILITY TRIGGER ATTACHED FROM BIRTH (reuse, never copy)
-- -----------------------------------------------------------------------------
-- 20260716000007's `enforce_tool_row_immutability` freezes visibility / org_id /
-- owner_id after insert. It is ATTACHED below, exactly as its header instructs
-- ("attach to each tool table, do not copy"). On this table the three frozen
-- columns are load-bearing: org_id is the candidate's identity (moving a row
-- between orgs would hand one candidate's answer to another's tree), owner_id is
-- the candidate, and visibility gates the whole read model.
--
-- MEMBERSHIP IN THE ORG TREE IS THE GATE. No `auth_user_has_permission` is
-- composed in — same decision as every tool table since inventory: the manifest's
-- permission keys are not (all) seeded in public.permissions, and a real
-- permission composes on top later with AND at the call site without loosening
-- anything here.
--
-- Does NOT touch anon or service_role. Does NOT touch any other table.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The table — org-scoped, visibility-bearing, default 'org'.
-- -----------------------------------------------------------------------------
create table public.candidate_answers (
  id uuid primary key default gen_random_uuid(),

  -- owner_id references users with NO ACTION (the default) — deliberate, matching
  -- every tool table: a user who still owns rows cannot be hard-deleted out from
  -- under them. org_id cascades: when the candidate's child org is removed, their
  -- answers go with it.
  owner_id uuid not null references public.users (id),
  org_id   uuid not null references public.organizations (id) on delete cascade,

  visibility text not null default 'org'
    check (visibility in ('private', 'org', 'restricted')),

  -- The question identifier (stable, from the tool's question bank) and a SNAPSHOT
  -- of the question text as asked (denormalized on purpose — see the header).
  question_key  text not null
    check (char_length(question_key) <= 100),
  question_text text not null
    check (char_length(question_text) <= 1000),

  -- The candidate's answer. '' by default — an unanswered question still has a row
  -- (materialized at invite time), it simply has no answer yet.
  answer text not null default ''
    check (char_length(answer) <= 4000),

  -- Display order within the questionnaire.
  position integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One answer row per question per org. Also blocks double-materialization: a
  -- child org hosts exactly one candidate, so this is "one answer per question per
  -- candidate" enforced by geography.
  constraint candidate_answers_org_question_unique unique (org_id, question_key)
);

comment on table  public.candidate_answers               is 'Cortex candidate-questionnaire answers. Each row lives in the CANDIDATE''S CHILD ORG (org_id), owned by the candidate user (owner_id). Read/written by the ordinary org-tree rules — the candidate as a member of their own org, recruiters in the parent org by downward inheritance, siblings never. No candidate-specific policy exists.';
comment on column public.candidate_answers.owner_id      is 'The candidate USER who owns the answer. Frozen after insert by the immutability trigger; the private-visibility branch of can_read/can_write keys on it.';
comment on column public.candidate_answers.org_id        is 'The candidate''s CHILD ORG. NEVER NULL. Frozen after insert — record_grants stores a denormalized copy and the whole access model assumes it holds still.';
comment on column public.candidate_answers.visibility    is 'Intended audience. Defaults to ''org'' (the questionnaire is visible up the candidate''s org tree). Frozen after insert.';
comment on column public.candidate_answers.question_key  is 'Stable identifier of the question from the tool''s question bank.';
comment on column public.candidate_answers.question_text is 'SNAPSHOT of the question as asked at invite time — denormalized ON PURPOSE. The bank lives in tool code; editing it later must not rewrite what a candidate was actually asked.';
comment on column public.candidate_answers.answer        is 'The candidate''s answer. '''' until answered.';

-- Indexes mirror time_entries: the org read path and the per-owner listing.
create index candidate_answers_org_id_idx   on public.candidate_answers (org_id);
create index candidate_answers_owner_id_idx on public.candidate_answers (owner_id);

-- -----------------------------------------------------------------------------
-- 2. RLS — SELECT via auth_user_can_read (the modern full read path) + the write
--    path gated by auth_user_can_write, with the owner pinned on INSERT.
-- -----------------------------------------------------------------------------
alter table public.candidate_answers enable row level security;

grant select, insert, update, delete on public.candidate_answers to authenticated;

create policy "read candidate answers the user is entitled to"
  on public.candidate_answers
  for select
  to authenticated
  using (
    private.auth_user_can_read('candidate_answers', id, org_id, owner_id, visibility)
  );

create policy "insert candidate answers you may write"
  on public.candidate_answers for insert to authenticated
  with check (
    private.auth_user_can_write('candidate_answers', id, org_id, owner_id, visibility)
    and owner_id = (select auth.uid())
  );

create policy "update candidate answers you may write"
  on public.candidate_answers for update to authenticated
  using      (private.auth_user_can_write('candidate_answers', id, org_id, owner_id, visibility))
  with check (private.auth_user_can_write('candidate_answers', id, org_id, owner_id, visibility));

create policy "delete candidate answers you may write"
  on public.candidate_answers for delete to authenticated
  using (private.auth_user_can_write('candidate_answers', id, org_id, owner_id, visibility));

-- -----------------------------------------------------------------------------
-- 3. Freeze visibility / org_id / owner_id — the EXISTING trigger function from
--    20260716000007, attached as its header instructs (no per-table copy).
-- -----------------------------------------------------------------------------
create trigger candidate_answers_immutable_fields
  before update on public.candidate_answers
  for each row
  execute function private.enforce_tool_row_immutability();
