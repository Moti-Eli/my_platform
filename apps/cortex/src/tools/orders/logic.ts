/**
 * Orders — internal business logic + event emission (Standard §2 `logic.ts`).
 *
 * Cloned from Notes' logic. This is the ONLY place orders touches its data
 * (through the provided `CortexDb` client — never raw SQL) and the ONLY place it
 * would emit events (through the provided event-bus `emit`). It receives `ctx`
 * from the shell and never fetches identity itself.
 *
 * Stage 1 covers the `suppliers` table only (20261005000001). Later stages add
 * their own tables to THIS logic (products, orders, order lines).
 *
 * SCOPED BY `org_id`, AND ONLY BY `org_id`. The `org_id` filter below is a
 * CONTEXT filter, not a security one — RLS is the enforcement point: every
 * suppliers policy requires org-tree membership AND the `orders.access`
 * permission.
 *
 * The writes below do NOT set `visibility`; the column defaults to 'org', exactly
 * as notes' createNote does.
 */
import { safeRandomUUID, type Ctx, type CortexDb, type DbRow } from "@platform/cortex-core";

export const SUPPLIERS_TABLE = "suppliers";

export interface Supplier {
  id: string;
  name: string;
  /** Phone as typed ('' when unset). Normalized for WhatsApp at send time (stage 4). */
  phone: string;
  contactName: string;
  email: string;
  /** Any other contact details — address, delivery days, hours. */
  notes: string;
  /** ISO timestamp — drives the "newest first" sort. */
  createdAt: string;
}

/** list_suppliers takes no input — the org comes from ctx, not the caller. */
export interface ListSuppliersInput {}
export interface CreateSupplierInput {
  name: string;
  phone?: string;
  contactName?: string;
  email?: string;
  notes?: string;
}
export interface UpdateSupplierInput {
  id: string;
  name?: string;
  phone?: string;
  contactName?: string;
  email?: string;
  notes?: string;
}
export interface DeleteSupplierInput {
  id: string;
}

export interface OrdersLogic {
  listSuppliers(input: ListSuppliersInput, ctx: Ctx): Promise<Supplier[]>;
  createSupplier(input: CreateSupplierInput, ctx: Ctx): Promise<{ id: string; createdAt: string }>;
  updateSupplier(input: UpdateSupplierInput, ctx: Ctx): Promise<{ id: string }>;
  deleteSupplier(input: DeleteSupplierInput, ctx: Ctx): Promise<{ id: string }>;
}

/** The event-bus surface the logic needs (from `@platform/cortex-core`). */
type Emit = (type: string, payload: unknown, ctx: Ctx) => Promise<void>;

/** Map a raw DB row to a typed supplier (the DB uses snake_case columns). The
 * text columns default to '' on the table, so they are never null — but coerce
 * defensively. */
function toSupplier(row: DbRow): Supplier {
  const text = (v: unknown) => (v == null ? "" : String(v));
  return {
    id: String(row.id),
    name: String(row.name),
    phone: text(row.phone),
    contactName: text(row.contact_name),
    email: text(row.email),
    notes: text(row.notes),
    createdAt: String(row.created_at),
  };
}

export function createOrdersLogic({ db, emit: _emit }: { db: CortexDb; emit: Emit }): OrdersLogic {
  return {
    async listSuppliers(_input, ctx) {
      // A CONTEXT filter — "show me THIS org's suppliers" — NOT a security filter.
      // RLS refuses every other org's rows (and every row, without orders.access).
      const rows = await db.select(SUPPLIERS_TABLE, { org_id: ctx.orgId });
      // Oldest first, as stored; the views re-sort for display (name / newest).
      const ordered = [...rows].sort((a, b) =>
        String(a.created_at).localeCompare(String(b.created_at)),
      );
      return ordered.map(toSupplier);
    },

    async createSupplier(input, ctx) {
      const id = safeRandomUUID();
      const now = new Date().toISOString();
      await db.insert(SUPPLIERS_TABLE, {
        id,
        // The mandatory fields (§6). Both are NOT NULL on the table. `visibility`
        // is deliberately omitted — the column defaults to 'org'.
        owner_id: ctx.userId,
        org_id: ctx.orgId,
        // tool columns
        name: input.name,
        phone: input.phone ?? "",
        contact_name: input.contactName ?? "",
        email: input.email ?? "",
        notes: input.notes ?? "",
        created_at: now,
        updated_at: now,
      });
      // createdAt is returned so the views can place the new row correctly under
      // the "newest first" sort without a refetch.
      return { id, createdAt: now };
    },

    async updateSupplier(input, _ctx) {
      // RLS gates the update ROW BY ROW. The where is by id alone — org scope is
      // enforced by RLS, not this filter. Only the fields actually sent are patched.
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.phone !== undefined) patch.phone = input.phone;
      if (input.contactName !== undefined) patch.contact_name = input.contactName;
      if (input.email !== undefined) patch.email = input.email;
      if (input.notes !== undefined) patch.notes = input.notes;
      await db.update(SUPPLIERS_TABLE, { id: input.id }, patch);
      return { id: input.id };
    },

    async deleteSupplier(input, _ctx) {
      // RLS gates the delete ROW BY ROW, exactly like update.
      await db.delete(SUPPLIERS_TABLE, { id: input.id });
      return { id: input.id };
    },
  };
}
