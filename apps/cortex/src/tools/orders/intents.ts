/**
 * Orders — the AI API ("the connection file", Standard §4).
 *
 * The AI never sees a table; it sees this list of actions and their zod schemas.
 * Handlers delegate to `logic` (the only code that touches the db client) and
 * receive `ctx` from the shell. Every name is `orders.<action>`.
 *
 * The length caps mirror the CHECK constraints on the tables, so an over-long
 * value is refused here with a clear schema error instead of reaching the DB.
 * A supplier's primary category is REQUIRED here on create even though the
 * column is nullable in the DB (existing rows) — the app is where it is enforced.
 * No action reads or writes a price (reserved column, out of scope).
 */
import { z } from "zod";
import { defineIntent } from "@platform/cortex-core";
import type { OrdersLogic } from "./logic";
import { UNIT_KEYS } from "./units";

/** Field caps — identical to the tables' CHECK constraints. */
export const SUPPLIER_LIMITS = {
  name: 200,
  phone: 30,
  contactName: 200,
  email: 320,
  notes: 2000,
} as const;
export const CATEGORY_NAME_MAX = 100;
export const PRODUCT_NAME_MAX = 200;

const supplier = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  contactName: z.string(),
  email: z.string(),
  notes: z.string(),
  primaryCategoryId: z.string().nullable(),
  createdAt: z.string(),
});
const category = z.object({ id: z.string(), name: z.string(), position: z.number() });
const product = z.object({
  id: z.string(),
  supplierId: z.string(),
  categoryId: z.string(),
  name: z.string(),
  defaultUnit: z.string(),
  archived: z.boolean(),
});

const supplierName = z.string().trim().min(1).max(SUPPLIER_LIMITS.name);
const phone = z.string().trim().max(SUPPLIER_LIMITS.phone);
const contactName = z.string().trim().max(SUPPLIER_LIMITS.contactName);
const email = z.string().trim().max(SUPPLIER_LIMITS.email);
const notes = z.string().trim().max(SUPPLIER_LIMITS.notes);
const categoryName = z.string().trim().min(1).max(CATEGORY_NAME_MAX);
const productName = z.string().trim().min(1).max(PRODUCT_NAME_MAX);
/** A unit key from the code-side list, or '' for "no default unit". */
const unit = z.enum(UNIT_KEYS).or(z.literal(""));
const id = z.object({ id: z.string() });

export function createOrdersIntents(logic: OrdersLogic) {
  return [
    // --- suppliers ----------------------------------------------------------
    defineIntent({
      name: "orders.list_suppliers",
      description: "List the suppliers in the current organization",
      input: z.object({}),
      output: z.array(supplier),
      handler: (input, ctx) => logic.listSuppliers(input, ctx),
    }),
    defineIntent({
      name: "orders.create_supplier",
      description:
        "Add a supplier (name and primary category required; phone, contact person, email and notes optional)",
      input: z.object({
        name: supplierName,
        primaryCategoryId: z.string().min(1),
        phone: phone.optional(),
        contactName: contactName.optional(),
        email: email.optional(),
        notes: notes.optional(),
      }),
      output: z.object({ id: z.string(), createdAt: z.string() }),
      handler: (input, ctx) => logic.createSupplier(input, ctx),
    }),
    defineIntent({
      name: "orders.update_supplier",
      description: "Edit a supplier's details or primary category",
      input: z.object({
        id: z.string(),
        name: supplierName.optional(),
        primaryCategoryId: z.string().min(1).optional(),
        phone: phone.optional(),
        contactName: contactName.optional(),
        email: email.optional(),
        notes: notes.optional(),
      }),
      output: id,
      handler: (input, ctx) => logic.updateSupplier(input, ctx),
    }),
    defineIntent({
      name: "orders.delete_supplier",
      description: "Delete a supplier (its products are deleted with it)",
      input: id,
      output: id,
      handler: (input, ctx) => logic.deleteSupplier(input, ctx),
    }),

    // --- categories ---------------------------------------------------------
    defineIntent({
      name: "orders.list_categories",
      description: "List the product categories in the current organization",
      input: z.object({}),
      output: z.array(category),
      handler: (input, ctx) => logic.listCategories(input, ctx),
    }),
    defineIntent({
      name: "orders.create_category",
      description: "Add a product category (e.g. cheeses, vegetables)",
      input: z.object({ name: categoryName }),
      output: id,
      handler: (input, ctx) => logic.createCategory(input, ctx),
    }),
    defineIntent({
      name: "orders.update_category",
      description: "Rename a product category",
      input: z.object({ id: z.string(), name: categoryName }),
      output: id,
      handler: (input, ctx) => logic.updateCategory(input, ctx),
    }),
    defineIntent({
      name: "orders.delete_category",
      description:
        "Delete a product category (refused while it has products or is a supplier's primary category)",
      input: id,
      output: id,
      handler: (input, ctx) => logic.deleteCategory(input, ctx),
    }),

    // --- products -----------------------------------------------------------
    defineIntent({
      name: "orders.list_products",
      description: "List every supplier product in the current organization",
      input: z.object({}),
      output: z.array(product),
      handler: (input, ctx) => logic.listProducts(input, ctx),
    }),
    defineIntent({
      name: "orders.create_product",
      description: "Add a product to a supplier's catalog, in a category, with an optional default unit",
      input: z.object({
        supplierId: z.string().min(1),
        categoryId: z.string().min(1),
        name: productName,
        defaultUnit: unit.optional(),
      }),
      output: id,
      handler: (input, ctx) => logic.createProduct(input, ctx),
    }),
    defineIntent({
      name: "orders.update_product",
      description: "Edit a product's name, category or default unit",
      input: z.object({
        id: z.string(),
        name: productName.optional(),
        categoryId: z.string().min(1).optional(),
        defaultUnit: unit.optional(),
      }),
      output: id,
      handler: (input, ctx) => logic.updateProduct(input, ctx),
    }),
    defineIntent({
      name: "orders.delete_product",
      description: "Delete a product from a supplier's catalog",
      input: id,
      output: id,
      handler: (input, ctx) => logic.deleteProduct(input, ctx),
    }),
  ];
}
