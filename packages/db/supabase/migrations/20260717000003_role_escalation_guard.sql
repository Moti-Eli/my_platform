-- =============================================================================
-- Migration: Forbid role-assignment escalation; delete the dead `users.view`
-- =============================================================================
--
-- This pays off the debt named in 20260608000003's own header. That migration
-- opened the first write path (assign/unassign roles, gated on `members.manage`)
-- and recorded the assumption that made it safe:
--
--     "'members.manage' is currently granted ONLY to admin roles ... IF
--      'members.manage' is ever granted to a non-admin role, that role could
--      grant the Admin role to anyone (including itself) or strip other admins.
--      Before that happens, add guardrails — e.g. forbid removing the last admin
--      of an org, and forbid self-escalation."
--
-- The last-admin half landed in 20260609000005. This is the self-escalation half,
-- and it lands BEFORE the assumption expires: roles are org-owned DATA, editable
-- by org admins, so the day a non-admin role is granted `members.manage` the hole
-- opens with no schema change to review. The guardrail must not depend on nobody
-- having done that yet.
--
-- THE RULE: you may only assign/revoke a role you could already confer — i.e. you
-- hold an is_admin role in that org, OR you hold the very role in question. So
-- `members.manage` becomes "manage members within the authority you already have"
-- rather than "hand out any role in the org, including Admin, including to
-- yourself".
--
-- MECHANISM — a BEFORE ROW trigger, not an RLS policy. RLS on membership_roles
-- keys on the ROW (organization_id); this rule is about the relationship between
-- the acting user's roles and the row's role, and the DELETE half must inspect
-- OLD. A trigger also fires for `service_role`, which RLS does not — see (e).
--
-- ORDER (verified, not assumed): a BEFORE ROW trigger fires BEFORE the RLS
-- WITH CHECK is evaluated. So a caller lacking `members.manage` hits THIS error,
-- not a policy violation. Both deny; only the message differs. The harness
-- asserts which mechanism actually fired rather than assuming.
--
-- RELATIONSHIP TO 20260609000005 (do not duplicate or fight it): that guard is a
-- DEFERRABLE INITIALLY DEFERRED constraint trigger judging the FINAL state at
-- COMMIT — "this org must not end the transaction with zero admins". This one is
-- an immediate BEFORE ROW trigger judging the ACTOR — "you may not confer what you
-- do not hold". Different question, different time, no overlap: an admin swapping
-- admins in one transaction passes both; a non-admin stripping an admin fails this
-- one immediately and never reaches commit.
--
-- WHY `members.manage` IS *NOT* SPLIT INTO `members.manage_admins`:
--   The roadmap's step 5 proposed that split. With this trigger it is dead on
--   arrival — a permission gating "may assign admin roles" could never fire.
--   Assigning an is_admin role already requires holding an is_admin role, and any
--   holder of one implicitly has EVERY permission via auth_user_has_permission's
--   `r.is_admin` branch. So the permission would be held by exactly the set of
--   users who already pass without it, and checked in exactly the situations where
--   it is redundant: granted-but-unenforceable. That is precisely the defect this
--   same migration deletes `users.view` for, and we decline to add a second
--   instance of it in the act of removing the first. The trigger does the work; a
--   permission would only document a boundary it does not guard.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Helper: may the current user assign/revoke <role> in <organization>?
-- -----------------------------------------------------------------------------
-- Deliberately mirrors private.auth_user_has_permission's exact shape — same
-- joins, same active-only guards on BOTH the membership and its organization (a
-- soft-deleted membership confers nothing; neither does one in a soft-deleted
-- org). The ONLY difference is the final predicate:
--
--     auth_user_has_permission:  r.is_admin OR <role grants p_permission_key>
--     auth_user_may_assign_role: r.is_admin OR r.id = p_role_id
--
-- i.e. true if the caller holds an is_admin role in that org (admins may confer
-- anything — without this an admin could not staff a role they do not hold, which
-- is most of what staffing IS), or holds the very role being conferred.
--
-- auth.uid() IS NULL (no JWT — service_role, or anon) yields no membership rows
-- and therefore FALSE. Fails closed by construction, not by a special case.
--
-- SECURITY DEFINER + `set search_path = ''` + fully-qualified names: the same
-- recursion-safe, search-path-locked pattern as every other helper here. It reads
-- membership_roles, which the trigger below is attached to — but triggers do not
-- fire on SELECT, so there is no recursion.
-- -----------------------------------------------------------------------------
create or replace function private.auth_user_may_assign_role(
  p_org_id uuid,
  p_role_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    join public.membership_roles mr on mr.membership_id = m.id
    join public.roles r on r.id = mr.role_id
    where m.user_id = auth.uid()
      and m.organization_id = p_org_id
      and m.deleted_at is null
      and o.deleted_at is null
      and (
        r.is_admin
        or r.id = p_role_id
      )
  );
$$;

comment on function private.auth_user_may_assign_role(uuid, uuid) is 'True when auth.uid() may confer/revoke p_role_id in p_org_id: they hold an is_admin role there, or hold that very role. Active memberships in active orgs only; false when auth.uid() is null. Mirrors auth_user_has_permission''s shape.';

grant execute on function private.auth_user_may_assign_role(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Trigger: enforce it on every write to membership_roles.
-- -----------------------------------------------------------------------------
-- BOOTSTRAP EXEMPTION (checked first, INSERT only): if the organization has ZERO
-- rows in membership_roles, allow the insert.
--
--   RATIONALE — this is a STRUCTURAL exemption, not "service_role is trusted".
--   In an org where no role has ever been assigned, nobody can possibly hold one,
--   so the question the rule asks ("do you hold this role, or an admin role?") has
--   no answer for anyone — the rule is not strict there, it is undefined. The
--   exemption exists because step 6 creates a PERSONAL ORGANIZATION ON SIGNUP:
--   org + membership + admin role, with no acting user and auth.uid() = null.
--   Without this, that org is unbuildable — its first admin can only be appointed
--   by an admin who cannot exist yet.
--
--   It is ONE-SHOT for every caller that reaches membership_roles through the API.
--   Returning an org to zero membership_roles requires DELETING its admin-role
--   rows, and this same trigger blocks that for anyone who is neither an admin nor
--   a holder of the role being revoked. The two halves lock each other: the
--   exemption is only safe because DELETE is guarded, and DELETE is only worth
--   guarding because the exemption exists.
--
--   THE HONEST LIMIT — the lock is NOT absolute, and it would be dishonest to
--   imply otherwise. The cascade exemption below (a2) means a caller who can
--   delete an org's MEMBERSHIPS (or roles, or the org) empties membership_roles
--   and thereby RE-ARMS the bootstrap exemption. No client can do this: neither
--   `anon` nor `authenticated` holds a DELETE grant on memberships / roles /
--   organizations (20260608000003 grants DML on membership_roles ONLY). It is
--   reachable only by the SERVICE KEY — a caller that already owns the database
--   outright and could simply UPDATE roles.is_admin, or call the trigger's own
--   helper, or drop the trigger. So this is not a new hole and not a reason to
--   narrow (a2) further; it is the pre-existing fact that the service key is
--   absolute. Against everything below that line, the exemption is one-shot.
--
-- DELETE IS COVERED DELIBERATELY. Revoking is not escalation, so it would be easy
-- to leave out. Two reasons not to:
--   1. Without it, a holder of `members.manage` could strip other admins down to
--      the last one — 20260609000005 only guards the LAST admin, so demoting every
--      admin but one is currently unguarded, and that is most of the damage.
--   2. Without it, the bootstrap exemption above becomes REACHABLE: empty an org's
--      membership_roles and the next insert is exempt. Guarding DELETE is what
--      makes the exemption one-shot rather than a renewable back door.
--
-- NO EXEMPTION FOR service_role. Triggers fire for it — it bypasses RLS, not
-- triggers — and that is the point rather than an oversight. A privileged caller
-- with no JWT has auth.uid() = null, so auth_user_may_assign_role returns false
-- and this raises, EXCEPT under the bootstrap exemption. That is the only path in.
-- The consequence is real and intended: server-side code that assigns roles must
-- either be bootstrapping a brand-new org, or act AS a user who may confer the
-- role (a JWT, i.e. the same path the UI takes). The dev seed and the harnesses
-- were updated to do exactly that rather than be exempted.
-- -----------------------------------------------------------------------------
create or replace function private.enforce_no_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_name text;
begin
  -- (a) Bootstrap: an org with no role assignments at all. Nobody holds anything,
  --     so there is no question to ask. INSERT only — see the header.
  if tg_op = 'INSERT' and not exists (
    select 1
    from public.membership_roles mr
    where mr.organization_id = new.organization_id
  ) then
    return new;
  end if;

  -- (a2) Referential cleanup: the parent membership or role is ALREADY GONE, so
  --      this DELETE is a CASCADE tidying up, not a revocation. You cannot revoke
  --      a role from a membership that no longer exists — the access was destroyed
  --      upstream and this row is debris. Without this the guard would reject
  --      `delete from organizations` / deleting a user (org -> roles/memberships ->
  --      membership_roles), making orgs and users UNDELETABLE by anyone, including
  --      service_role — verified, not theorized: the org survived the delete.
  --
  --      PRECEDENT — 20260609000005 hit this same trap and its header names it
  --      ("a naive BEFORE/AFTER-statement trigger would see a half-applied state
  --      during CASCADE deletes ... and would wrongly reject legitimate org/user
  --      deletion"). Its escape is `if not exists (select 1 from public.organizations
  --      o where o.id = v_org) then return null;` — "parent gone -> the invariant is
  --      moot". This is that same construction, applied to the child's TWO parents.
  --      It keys ONLY on the parent being gone: never on the caller's role, never on
  --      the absence of a JWT.
  --
  --      BOTH parents are covered because the cascade paths differ: deleting an ORG
  --      cascades through roles AND memberships; deleting a USER only through
  --      memberships; deleting a ROLE only through roles. All three are verified in
  --      scripts/verify-role-escalation.ts. The ordering this rests on — that the
  --      parent row is already invisible to the child's BEFORE DELETE trigger — is
  --      probed there explicitly rather than assumed.
  --
  --      NOT AN ESCALATION PATH: reaching it means deleting the membership, role,
  --      or org row itself. `authenticated` holds no DELETE grant on any of those
  --      three (20260608000003 grants DML on membership_roles ONLY), so a client
  --      cannot reach it at all; and deleting a membership revokes the role more
  --      completely than stripping the assignment would. A SOFT-deleted membership
  --      still EXISTS, so it is NOT exempt here — offboarding stays fully guarded.
  if tg_op = 'DELETE' and (
    not exists (select 1 from public.memberships m where m.id = old.membership_id)
    or not exists (select 1 from public.roles r where r.id = old.role_id)
  ) then
    return old;
  end if;

  -- (b) INSERT / UPDATE: you must be entitled to confer the role you are writing.
  if tg_op in ('INSERT', 'UPDATE') then
    if not private.auth_user_may_assign_role(new.organization_id, new.role_id) then
      select r.name into v_role_name from public.roles r where r.id = new.role_id;
      raise exception 'Not allowed to assign the role "%" — you must hold an admin role in this organization, or hold that role yourself.',
        coalesce(v_role_name, new.role_id::text)
        using errcode = 'insufficient_privilege',
              hint = 'Assigning a role you do not hold is privilege escalation. Ask an admin of this organization.';
    end if;
  end if;

  -- (c) UPDATE / DELETE: you must be entitled to confer the role you are removing.
  if tg_op in ('UPDATE', 'DELETE') then
    if not private.auth_user_may_assign_role(old.organization_id, old.role_id) then
      select r.name into v_role_name from public.roles r where r.id = old.role_id;
      raise exception 'Not allowed to revoke the role "%" — you must hold an admin role in this organization, or hold that role yourself.',
        coalesce(v_role_name, old.role_id::text)
        using errcode = 'insufficient_privilege',
              hint = 'Revoking a role you do not hold lets you strip other members of authority you never had.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function private.enforce_no_role_escalation() is 'BEFORE ROW guard on membership_roles: you may only assign/revoke a role you could already confer (admin in the org, or a holder of that role). Exempts only the very first assignment in an org (bootstrap; see 20260717000003 header). Fires for service_role too.';

-- Trigger function is invoked by the trigger, never called directly.
revoke all on function private.enforce_no_role_escalation() from public;

create trigger membership_roles_no_escalation
  before insert or update or delete on public.membership_roles
  for each row
  execute function private.enforce_no_role_escalation();

-- -----------------------------------------------------------------------------
-- 3. Delete the unused `users.view` permission.
-- -----------------------------------------------------------------------------
-- Exactly the defect 20260610000003 removed `users.invite` for, and the same
-- remedy: `users.view` was seeded in the original catalog (20260605000001) and is
-- granted to every org's non-admin "Member" role, but it is CHECKED NOWHERE. Every
-- `requiredPermission` in the web and mobile registries is either null or
-- `members.manage`; no policy, helper, or server action reads it. It is a granted
-- permission that gates nothing — it misleadingly implies that viewing users is
-- permission-controlled when membership alone decides it.
--
-- WHY REMOVE RATHER THAN WIRE IT: viewing users within your org is ALREADY gated,
-- by RLS on `users`/`memberships` via the membership helpers. Wiring `users.view`
-- would either duplicate that check or, worse, become a second source of truth that
-- can disagree with it. Membership is the marker; the permission adds nothing.
--
-- CONSEQUENCE — the seeded "Member" role is left with ZERO permissions, and that is
-- CORRECT, not an oversight to backfill. Membership itself is the marker of "may
-- see this org's data"; permissions are for ACTIONS beyond that baseline, and a
-- plain member has none. An empty permission set is the honest encoding of that.
--
-- EFFECT: deleting the permission cascades its role_permissions rows away
-- (role_permissions.permission_id is ON DELETE CASCADE), so every Member role that
-- was granted it simply loses a permission that did nothing. Forward-only: we do
-- NOT edit 20260605000001's seed block; on a fresh replay it inserts the row and
-- this migration removes it (net: absent), which is the correct forward pattern.
-- -----------------------------------------------------------------------------
delete from public.permissions where key = 'users.view';
