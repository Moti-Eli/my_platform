-- =============================================================================
-- Migration: `shift_employees` — a composite-FK target that pins the USER
-- =============================================================================
--
-- Stage 2's submission rows (20261028000008) are PRIVATE and owned by the
-- employee: owner_id must be the very user the employee_id row points at. No
-- policy can check that without a new function, and stage 2 adds none. The DB
-- can still refuse a mismatch with a plain COMPOSITE FOREIGN KEY:
--
--     shift_submissions (employee_id, org_id, owner_id)
--       → shift_employees (id, org_id, user_id)
--
-- which needs that triple to be UNIQUE here. It trivially is (id is the primary
-- key), so this constraint adds no new rule to this table — it only makes the
-- triple referenceable. The same trick stage 1 uses for same-org links.
--
-- A new migration, as always: 20261008000002 is applied and is not edited.
-- Touches nothing else: no policy, no grant, no other column.
-- =============================================================================

alter table public.shift_employees
  add constraint shift_employees_id_org_user_key unique (id, org_id, user_id);

comment on constraint shift_employees_id_org_user_key on public.shift_employees
  is 'Composite-FK target for stage-2 submissions: pins a submission''s owner_id to the employee''s own user_id.';
