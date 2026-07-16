-- =============================================================================
-- Migration: tool rows' visibility / org_id / owner_id are IMMUTABLE
-- =============================================================================
--
-- One reusable BEFORE UPDATE trigger function, attached per tool table, rejecting
-- any UPDATE that CHANGES a row's `visibility`, `org_id`, or `owner_id`. These
-- three are the columns the entire access model is computed from, and the model
-- assumes they hold still. This migration makes that assumption true instead of
-- merely hoped for.
--
-- It is the promise made in two earlier headers, now kept: `record_grants`
-- (20260716000004) said its denormalized `org_id` is "kept honest by the (later)
-- trigger making a tool row's org_id immutable", and `auth_user_can_grant`
-- (20260716000006) justified having no private branch on the grounds that "a later
-- migration makes `visibility` IMMUTABLE, so a private row cannot be upgraded to
-- shareable after the fact". This is that migration. Both of those designs are
-- load-bearing on this one.
--
-- -----------------------------------------------------------------------------
-- WHY THIS LOOKS OVER-STRICT AND IS NOT
-- -----------------------------------------------------------------------------
--
-- 1. NO ROLE EXEMPTION — NOT EVEN service_role. DELIBERATE.
--    Triggers fire for EVERY role. `service_role` bypasses RLS; it does NOT bypass
--    triggers. So this guard binds the shell's own data-layer, which is the only
--    write path Cortex has. That is the entire point, not an oversight:
--
--      This guard exists BECAUSE CODE CAN BE WRONG. Exempting the shell would
--      exempt the whole threat model — there is nothing else to guard against.
--      A guard that trusts the only caller guards nothing.
--
--    The precedent is `private.enforce_org_keeps_admin` (20260609000005), which
--    holds the last-admin invariant "even against direct privileged calls" for
--    exactly this reason. The DB is the enforcement point. An invariant enforced
--    only in application code is a convention, and conventions do not survive a
--    refactor, a new endpoint, or a migration written at speed.
--
-- 2. `visibility` IMMUTABILITY IS LOAD-BEARING FOR auth_user_can_grant.
--    That function has NO private branch, and the reason given was precisely that
--    a private row cannot be re-labelled 'restricted' in order to share it. If
--    visibility were mutable, its narrowness would be bypassable in one UPDATE:
--    flip 'private' -> 'restricted', and now the grant path applies to a row that
--    was never meant to leave its owner. The same UPDATE in the other direction
--    ('restricted' -> 'org') is worse: it exposes a grants-only row to the entire
--    org tree at a stroke, with no grant ever issued and nothing in record_grants
--    to show for it. A row's audience is decided at BIRTH, by the tool, and does
--    not drift.
--
-- 3. `org_id` IMMUTABILITY IS WHAT KEEPS record_grants' DENORMALIZED org_id HONEST.
--    record_grants carries a COPY of the granted row's org, because it cannot look
--    the row up: `table_name` is dynamic, so no static SQL can resolve it. A copy
--    is only as good as the guarantee that the original never moves. Make org_id
--    mutable and that copy silently starts lying — the grant claims one org, the
--    row lives in another, and every check keyed on the copy is answering a
--    question about a row that has left. Nothing would ERROR; it would just be
--    wrong. This trigger is what turns that duplication from a second source of
--    truth into a cache of a constant.
--
-- 4. `owner_id` IMMUTABILITY closes the matching hole on the private branch:
--    can_read/can_write admit a private row to `p_owner_id = auth.uid()`, so a
--    mutable owner_id would let a private row be handed to someone else — or taken —
--    with no grant and no trace.
--
-- 5. THE ESCAPE HATCH IS DELETE + RE-INSERT, AND THAT IS CORRECT.
--    This is not a workaround around an over-strict rule; it is the honest way to
--    express the operation. A row moving between orgs cannot carry its grants:
--    grants reference org-scoped ROLES and GROUPS, which mean nothing in the
--    destination org (and whose grants the subject-in-tree trigger would reject
--    outright). A moved row must have its grants REBUILT from the manifest's
--    defaultGrants, which is exactly what re-inserting does — the delete cascades
--    the old grants away and creation seeds the new ones. An UPDATE would silently
--    keep grants pointing at the origin org's subjects. "Moving" a row is a
--    create-and-destroy, so the API should be too.
--
-- -----------------------------------------------------------------------------
-- IS DISTINCT FROM, NOT <> — this is not a stylistic preference
-- -----------------------------------------------------------------------------
-- The comparison must be `IS DISTINCT FROM`. A client or ORM that re-sends EVERY
-- column on an update (most do — PostgREST, and any "save the whole object" form)
-- must still succeed when the values are unchanged. Only an actual CHANGE raises.
-- With `<>`, a NULL on either side yields NULL rather than false, the `if` does not
-- fire, and the check silently passes — so `<>` would be both too strict in the
-- ordinary re-send case and too lax around NULLs. `IS DISTINCT FROM` is
-- NULL-safe and means what we actually want: "did this value change?"
--
-- -----------------------------------------------------------------------------
-- ONE FUNCTION, ATTACHED PER TABLE
-- -----------------------------------------------------------------------------
-- The function is written ONCE and generic (it reads NEW/OLD, not a hard-coded
-- table). Future tool tables attach this same function; do NOT write a per-table
-- copy — three copies of an invariant is three places to forget one.
--
-- If it is ever attached to a table lacking one of the three columns, it will fail
-- at RUNTIME with an undefined-column error on the first UPDATE. That is CORRECT
-- and intended: a tool table without visibility/org_id/owner_id does not fit the
-- access model, and failing loudly at the first write beats silently enforcing
-- nothing. We are not defending against that with a column-existence check — a
-- guard that quietly skips tables it doesn't understand is how you end up with an
-- unguarded table nobody noticed.
--
-- NOT ATTACHED TO app_instances — deliberate. It is a SHELL table, not a tool
-- table: it has no `visibility` column at all (so the trigger would error on every
-- update), and `record_grants` never points at it, so neither the can_grant nor the
-- denormalization argument applies. Its policy remains plain is_member_of_tree.
-- inventory_items is the only tool table today, so it is the only attachment.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. private.enforce_tool_row_immutability() — reusable, table-agnostic.
-- -----------------------------------------------------------------------------
create or replace function private.enforce_tool_row_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Each column gets its OWN message naming the attempted transition. A single
  -- generic "immutable field changed" would make the common case — an ORM
  -- re-sending a column you forgot it tracks — a guessing game at 3am.

  if new.visibility is distinct from old.visibility then
    raise exception 'visibility is immutable on public.% — attempted ''%'' -> ''%''',
      tg_table_name, old.visibility, new.visibility
      using errcode = 'check_violation',
            hint = 'A row''s audience is decided at creation. To change it, delete the row and re-insert it so its grants are rebuilt from defaultGrants.';
  end if;

  if new.org_id is distinct from old.org_id then
    raise exception 'org_id is immutable on public.% — attempted % -> %',
      tg_table_name, old.org_id, new.org_id
      using errcode = 'check_violation',
            hint = 'record_grants stores a denormalized copy of this org_id and cannot look the row up (table_name is dynamic). Delete and re-insert in the target org; grants do not travel between orgs.';
  end if;

  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id is immutable on public.% — attempted % -> %',
      tg_table_name, old.owner_id, new.owner_id
      using errcode = 'check_violation',
            hint = 'The private-visibility branch of can_read/can_write is keyed on owner_id. Delete and re-insert to re-home a row.';
  end if;

  return new;
end;
$$;

comment on function private.enforce_tool_row_immutability() is 'BEFORE UPDATE guard for Cortex TOOL tables: rejects any change to visibility / org_id / owner_id (IS DISTINCT FROM, so re-sending unchanged values is fine). Reusable — attach to each tool table, do not copy. Fires for every role INCLUDING service_role: triggers are not bypassed by RLS-bypassing roles, and the shell is the only write path, so exempting it would exempt the threat model.';

-- Trigger function is invoked by the trigger, never called directly.
revoke all on function private.enforce_tool_row_immutability() from public;

-- -----------------------------------------------------------------------------
-- 2. Attach to public.inventory_items — the only tool table today.
-- -----------------------------------------------------------------------------
create trigger inventory_items_immutable_fields
  before update on public.inventory_items
  for each row
  execute function private.enforce_tool_row_immutability();
