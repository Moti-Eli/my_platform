/**
 * Orders — internal business logic + event emission (Standard §2 `logic.ts`).
 *
 * Cloned from Notes' logic. This is the ONLY place orders touches its data
 * (through the provided `CortexDb` client — never raw SQL) and the ONLY place it
 * would emit events (through the provided event-bus `emit`). It receives `ctx`
 * from the shell and never fetches identity itself.
 *
 * Tables (all gated by RLS on org-tree membership AND `orders.access`):
 *   - suppliers          (20261005000001, primary category 20261005000006)
 *   - order_categories   (20261005000004)
 *   - supplier_products  (20261005000005)
 *
 * The `org_id` filters below are CONTEXT filters, not security ones — RLS is the
 * enforcement point. The writes do NOT set `visibility`; it defaults to 'org'.
 *
 * PRICES ARE OUT OF SCOPE: supplier_products.price exists in the DB (reserved for
 * the supplier-built catalog) but is never read into these types nor written.
 */
import { safeRandomUUID, type Ctx, type CortexDb, type DbRow } from "@platform/cortex-core";

export const SUPPLIERS_TABLE = "suppliers";
export const CATEGORIES_TABLE = "order_categories";
export const PRODUCTS_TABLE = "supplier_products";

export interface Supplier {
  id: string;
  name: string;
  /** Phone as typed ('' when unset). Normalized for WhatsApp at send time (stage 4). */
  phone: string;
  contactName: string;
  email: string;
  /** Any other contact details — address, delivery days, hours. */
  notes: string;
  /** Nullable in the DB (pre-existing suppliers); required by the app on create/edit. */
  primaryCategoryId: string | null;
  /** ISO timestamp. */
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  position: number;
}

export interface Product {
  id: string;
  supplierId: string;
  categoryId: string;
  name: string;
  /** A unit KEY from `units.ts`, or '' for none. */
  defaultUnit: string;
  archived: boolean;
}

/** The editable fields of a supplier. */
export interface SupplierFieldsInput {
  name: string;
  phone?: string;
  contactName?: string;
  email?: string;
  notes?: string;
}
export interface CreateSupplierInput extends SupplierFieldsInput {
  primaryCategoryId: string;
}
export interface UpdateSupplierInput extends Partial<SupplierFieldsInput> {
  id: string;
  primaryCategoryId?: string;
}
export interface CreateCategoryInput {
  name: string;
}
export interface UpdateCategoryInput {
  id: string;
  name: string;
}
export interface CreateProductInput {
  supplierId: string;
  categoryId: string;
  name: string;
  defaultUnit?: string;
}
/** Many products for ONE supplier + category + unit (a pasted list). */
export interface CreateProductsInput {
  supplierId: string;
  categoryId: string;
  defaultUnit?: string;
  names: string[];
}
export interface CreateProductsResult {
  created: Array<{ id: string; name: string }>;
  /** Names whose insert failed (e.g. a duplicate added meanwhile by someone else). */
  failed: string[];
}
export interface UpdateProductInput {
  id: string;
  name?: string;
  categoryId?: string;
  defaultUnit?: string;
}
/** Every list_* takes no input — the org comes from ctx, not the caller. */
export interface ListInput {}
export interface IdInput {
  id: string;
}

export interface OrdersLogic {
  listSuppliers(input: ListInput, ctx: Ctx): Promise<Supplier[]>;
  createSupplier(input: CreateSupplierInput, ctx: Ctx): Promise<{ id: string; createdAt: string }>;
  updateSupplier(input: UpdateSupplierInput, ctx: Ctx): Promise<{ id: string }>;
  deleteSupplier(input: IdInput, ctx: Ctx): Promise<{ id: string }>;

  listCategories(input: ListInput, ctx: Ctx): Promise<Category[]>;
  createCategory(input: CreateCategoryInput, ctx: Ctx): Promise<{ id: string }>;
  updateCategory(input: UpdateCategoryInput, ctx: Ctx): Promise<{ id: string }>;
  deleteCategory(input: IdInput, ctx: Ctx): Promise<{ id: string }>;

  listProducts(input: ListInput, ctx: Ctx): Promise<Product[]>;
  createProduct(input: CreateProductInput, ctx: Ctx): Promise<{ id: string }>;
  createProducts(input: CreateProductsInput, ctx: Ctx): Promise<CreateProductsResult>;
  updateProduct(input: UpdateProductInput, ctx: Ctx): Promise<{ id: string }>;
  deleteProduct(input: IdInput, ctx: Ctx): Promise<{ id: string }>;
}

/** The event-bus surface the logic needs (from `@platform/cortex-core`). */
type Emit = (type: string, payload: unknown, ctx: Ctx) => Promise<void>;

const text = (v: unknown) => (v == null ? "" : String(v));

function toSupplier(row: DbRow): Supplier {
  return {
    id: String(row.id),
    name: String(row.name),
    phone: text(row.phone),
    contactName: text(row.contact_name),
    email: text(row.email),
    notes: text(row.notes),
    primaryCategoryId: row.primary_category_id == null ? null : String(row.primary_category_id),
    createdAt: String(row.created_at),
  };
}

function toCategory(row: DbRow): Category {
  return {
    id: String(row.id),
    name: String(row.name),
    position: Number(row.position ?? 0),
  };
}

function toProduct(row: DbRow): Product {
  return {
    id: String(row.id),
    supplierId: String(row.supplier_id),
    categoryId: String(row.category_id),
    name: String(row.name),
    defaultUnit: text(row.default_unit),
    archived: row.archived === true,
  };
}

/** The mandatory fields (§6) every insert carries. `visibility` is omitted — it
 * defaults to 'org'. */
function ownership(ctx: Ctx, now: string) {
  return { owner_id: ctx.userId, org_id: ctx.orgId, created_at: now, updated_at: now };
}

export function createOrdersLogic({ db, emit: _emit }: { db: CortexDb; emit: Emit }): OrdersLogic {
  return {
    // --- suppliers ----------------------------------------------------------
    async listSuppliers(_input, ctx) {
      const rows = await db.select(SUPPLIERS_TABLE, { org_id: ctx.orgId });
      return rows.map(toSupplier);
    },

    async createSupplier(input, ctx) {
      const id = safeRandomUUID();
      const now = new Date().toISOString();
      await db.insert(SUPPLIERS_TABLE, {
        id,
        ...ownership(ctx, now),
        name: input.name,
        phone: input.phone ?? "",
        contact_name: input.contactName ?? "",
        email: input.email ?? "",
        notes: input.notes ?? "",
        primary_category_id: input.primaryCategoryId,
      });
      return { id, createdAt: now };
    },

    async updateSupplier(input, _ctx) {
      // Only the fields actually sent are patched. RLS gates the row.
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.phone !== undefined) patch.phone = input.phone;
      if (input.contactName !== undefined) patch.contact_name = input.contactName;
      if (input.email !== undefined) patch.email = input.email;
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.primaryCategoryId !== undefined) patch.primary_category_id = input.primaryCategoryId;
      await db.update(SUPPLIERS_TABLE, { id: input.id }, patch);
      return { id: input.id };
    },

    async deleteSupplier(input, _ctx) {
      // CASCADES to the supplier's products (supplier_products_supplier_fk).
      // STAGE 3: once orders exist this is refused for suppliers with orders
      // (ON DELETE RESTRICT) and an archive action replaces it — see README.
      await db.delete(SUPPLIERS_TABLE, { id: input.id });
      return { id: input.id };
    },

    // --- categories ---------------------------------------------------------
    async listCategories(_input, ctx) {
      const rows = await db.select(CATEGORIES_TABLE, { org_id: ctx.orgId });
      return rows.map(toCategory);
    },

    async createCategory(input, ctx) {
      const id = safeRandomUUID();
      await db.insert(CATEGORIES_TABLE, {
        id,
        ...ownership(ctx, new Date().toISOString()),
        name: input.name,
      });
      return { id };
    },

    async updateCategory(input, _ctx) {
      await db.update(
        CATEGORIES_TABLE,
        { id: input.id },
        { name: input.name, updated_at: new Date().toISOString() },
      );
      return { id: input.id };
    },

    async deleteCategory(input, _ctx) {
      // Refused by the DB while the category has products or is some supplier's
      // primary category (ON DELETE RESTRICT); the views disable the action first.
      await db.delete(CATEGORIES_TABLE, { id: input.id });
      return { id: input.id };
    },

    // --- products -----------------------------------------------------------
    async listProducts(_input, ctx) {
      const rows = await db.select(PRODUCTS_TABLE, { org_id: ctx.orgId });
      return rows.map(toProduct);
    },

    async createProduct(input, ctx) {
      const id = safeRandomUUID();
      await db.insert(PRODUCTS_TABLE, {
        id,
        ...ownership(ctx, new Date().toISOString()),
        supplier_id: input.supplierId,
        category_id: input.categoryId,
        name: input.name,
        default_unit: input.defaultUnit ?? "",
      });
      return { id };
    },

    async createProducts(input, ctx) {
      // NOT ATOMIC, deliberately: CortexDb inserts one row at a time and making
      // this all-or-nothing would mean changing @platform/cortex-core. Each row
      // is inserted on its own; a failure is recorded and the rest continue, and
      // the caller reports exactly how many were added / failed. Re-pasting is
      // safe — rows that made it are then skipped as already existing.
      const result: CreateProductsResult = { created: [], failed: [] };
      for (const name of input.names) {
        const id = safeRandomUUID();
        try {
          await db.insert(PRODUCTS_TABLE, {
            id,
            ...ownership(ctx, new Date().toISOString()),
            supplier_id: input.supplierId,
            category_id: input.categoryId,
            name,
            default_unit: input.defaultUnit ?? "",
          });
          result.created.push({ id, name });
        } catch {
          result.failed.push(name);
        }
      }
      return result;
    },

    async updateProduct(input, _ctx) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.categoryId !== undefined) patch.category_id = input.categoryId;
      if (input.defaultUnit !== undefined) patch.default_unit = input.defaultUnit;
      await db.update(PRODUCTS_TABLE, { id: input.id }, patch);
      return { id: input.id };
    },

    async deleteProduct(input, _ctx) {
      await db.delete(PRODUCTS_TABLE, { id: input.id });
      return { id: input.id };
    },
  };
}
