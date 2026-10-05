/**
 * Orders — the AI API ("the connection file", Standard §4).
 *
 * The AI never sees a table; it sees this list of actions and their zod schemas.
 * Handlers delegate to `logic` (the only code that touches the db client) and
 * receive `ctx` from the shell. Every name is `orders.<action>`.
 *
 * The length caps mirror the CHECK constraints on public.suppliers
 * (20261005000001), so an over-long value is refused here with a clear schema
 * error instead of reaching the DB as a constraint violation.
 */
import { z } from "zod";
import { defineIntent } from "@platform/cortex-core";
import type { OrdersLogic } from "./logic";

/** Field caps — identical to the table's CHECK constraints. */
export const SUPPLIER_LIMITS = {
  name: 200,
  phone: 30,
  contactName: 200,
  email: 320,
  notes: 2000,
} as const;

const supplier = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  contactName: z.string(),
  email: z.string(),
  notes: z.string(),
  createdAt: z.string(),
});

const name = z.string().trim().min(1).max(SUPPLIER_LIMITS.name);
const phone = z.string().trim().max(SUPPLIER_LIMITS.phone);
const contactName = z.string().trim().max(SUPPLIER_LIMITS.contactName);
const email = z.string().trim().max(SUPPLIER_LIMITS.email);
const notes = z.string().trim().max(SUPPLIER_LIMITS.notes);

export function createOrdersIntents(logic: OrdersLogic) {
  return [
    defineIntent({
      name: "orders.list_suppliers",
      description: "List the suppliers in the current organization",
      input: z.object({}),
      output: z.array(supplier),
      handler: (input, ctx) => logic.listSuppliers(input, ctx),
    }),

    defineIntent({
      name: "orders.create_supplier",
      description: "Add a supplier (name required; phone, contact person, email and notes optional)",
      input: z.object({
        name,
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
      description: "Edit a supplier's details",
      input: z.object({
        id: z.string(),
        name: name.optional(),
        phone: phone.optional(),
        contactName: contactName.optional(),
        email: email.optional(),
        notes: notes.optional(),
      }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.updateSupplier(input, ctx),
    }),

    defineIntent({
      name: "orders.delete_supplier",
      description: "Delete a supplier",
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.deleteSupplier(input, ctx),
    }),
  ];
}
