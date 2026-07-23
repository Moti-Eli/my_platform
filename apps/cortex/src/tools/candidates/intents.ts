/**
 * Candidates — the AI API ("the connection file", Standard §4).
 *
 * The AI never sees a table; it sees this list of actions and their zod schemas.
 * Handlers delegate to `logic` (the only code that touches the db client) and
 * receive `ctx` from the shell — they never fetch it or write SQL themselves.
 * Every name is `candidates.<action>`.
 *
 * NOTE (injected, not singleton): `logic` needs the db client + event-bus, which
 * are created at runtime, so intents are produced by `createCandidatesIntents(logic)`
 * rather than importing a global singleton. Same shapes as §4, dependencies
 * injected instead of global.
 *
 * ONE SHAPE DIFFERENCE FROM NOTES: a candidate moves through a pipeline, so on
 * top of the generic `update_candidate` there is `set_stage` — the single verb
 * for stage transitions (archiving optionally records a reject reason). `stage`
 * is NOT accepted by create_candidate: the DB defaults it to 'contact'.
 */
import { z } from "zod";
import { defineIntent } from "@platform/cortex-core";
import type { CandidatesLogic } from "./logic";

/** The stage vocabulary — mirrors the table's CHECK constraint. */
const stage = z.enum(["contact", "interview", "intake", "archived"]);

/** One candidate as returned to the AI/views. Text fields are always strings
 * ('' when unset — the columns default to '', never null), `tags` always an
 * array, `rejectReason` maps from the DB's `reject_reason`. */
const candidate = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  stage,
  summary: z.string(),
  tags: z.array(z.string()),
  urgent: z.boolean(),
  rejectReason: z.string(),
  // Card fields (20260723000002). These MUST be declared here: zod strips
  // undeclared keys on parse, so omitting them would silently drop them from
  // every query_list result.
  hasCertificate: z.boolean(),
  phone: z.string(),
  city: z.string(),
  email: z.string(),
  impression: z.string(),
  availability: z.string(),
  hasCar: z.boolean(),
  salaryExpectation: z.string(),
});

export function createCandidatesIntents(logic: CandidatesLogic) {
  return [
    defineIntent({
      name: "candidates.query_list",
      description: "List the candidates in the current organization",
      input: z.object({}),
      output: z.array(candidate),
      handler: (input, ctx) => logic.queryList(input, ctx),
    }),

    defineIntent({
      name: "candidates.create_candidate",
      description:
        "Create a new candidate (starts at the 'contact' stage), optionally with a role, summary and tags",
      input: z.object({
        name: z.string(),
        role: z.string().optional(),
        summary: z.string().optional(),
        tags: z.array(z.string()).optional(),
        hasCertificate: z.boolean().optional(),
        phone: z.string().optional(),
        city: z.string().optional(),
        email: z.string().optional(),
        impression: z.string().optional(),
        availability: z.string().optional(),
        hasCar: z.boolean().optional(),
        salaryExpectation: z.string().optional(),
      }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.createCandidate(input, ctx),
    }),

    defineIntent({
      name: "candidates.update_candidate",
      description:
        "Edit a candidate's fields: name, role, summary, tags, urgent flag, contact details (phone/city/email), impression, availability, certificate/car flags, salary expectation",
      input: z.object({
        id: z.string(),
        name: z.string().optional(),
        role: z.string().optional(),
        summary: z.string().optional(),
        tags: z.array(z.string()).optional(),
        urgent: z.boolean().optional(),
        hasCertificate: z.boolean().optional(),
        phone: z.string().optional(),
        city: z.string().optional(),
        email: z.string().optional(),
        impression: z.string().optional(),
        availability: z.string().optional(),
        hasCar: z.boolean().optional(),
        salaryExpectation: z.string().optional(),
      }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.updateCandidate(input, ctx),
    }),

    defineIntent({
      name: "candidates.set_stage",
      description:
        "Move a candidate to a pipeline stage; archiving may record an optional reject reason",
      input: z.object({
        id: z.string(),
        stage,
        rejectReason: z.string().optional(),
      }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.setStage(input, ctx),
    }),

    defineIntent({
      name: "candidates.delete_candidate",
      description: "Delete a candidate",
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
      handler: (input, ctx) => logic.deleteCandidate(input, ctx),
    }),
  ];
}
