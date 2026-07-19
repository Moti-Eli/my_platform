/**
 * Staff — the AI API ("the connection file", Standard §4). READ-ONLY this step:
 * one intent, `staff.list_members`, and no writes.
 *
 * The handler delegates to `logic` (the only code that touches the client) and
 * receives `ctx` from the shell — it never fetches identity or writes SQL itself.
 *
 * NOTE (injected, not singleton): `logic` needs the RLS-client factory, created at
 * runtime, so intents are produced by `createStaffIntents(logic)` rather than
 * importing a global singleton.
 */
import { z } from "zod";
import { defineIntent } from "@platform/cortex-core";
import type { StaffLogic } from "./logic";

/** One org member as returned to the AI/views. `displayName` is nullable (a member
 * need not have set one); `isAdmin` drives the per-row role pill. */
const member = z.object({
  membershipId: z.string(),
  userId: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
  isAdmin: z.boolean(),
  joinedAt: z.string(),
});

export function createStaffIntents(logic: StaffLogic) {
  return [
    defineIntent({
      name: "staff.list_members",
      description: "List the members of the current organization",
      input: z.object({}),
      output: z.array(member),
      handler: (input, ctx) => logic.listMembers(input, ctx),
    }),
  ];
}
