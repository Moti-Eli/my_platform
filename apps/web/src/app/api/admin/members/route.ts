import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/admin/api-auth";
import { addMemberToOrganization } from "@/lib/admin/add-member";

/**
 * POST /api/admin/members — add a user to an organization (mobile-facing).
 *
 * Auth: `Authorization: Bearer <supabase access_token>`. The token is validated
 * server-side and a user-scoped (RLS) client is built from it; the shared
 * `addMemberToOrganization` then re-checks `members.manage` in the target org
 * (the security boundary, which also enforces tenant isolation) before the
 * secret key is ever touched. See ARCHITECTURE.md #26.
 *
 * Responses are `{ error: '<i18n key under "members">' }` (never raw messages):
 *   401 unauthorized · 400 invalidRequest|invalidEmail|invalidName ·
 *   403 notAllowed · 409 emailExists · 503 notConfigured · 500 addFailed ·
 *   200 { ok: true, userId }.
 * Non-POST methods get 405 automatically (only POST is exported).
 */
const STATUS: Record<string, number> = {
  invalidRequest: 400,
  invalidEmail: 400,
  invalidName: 400,
  notAllowed: 403,
  emailExists: 409,
  notConfigured: 503,
  addFailed: 500,
};

export async function POST(req: Request): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalidRequest" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "invalidRequest" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email : "";
  const displayName = typeof b.displayName === "string" ? b.displayName : "";
  const targetRole = typeof b.targetRole === "string" ? b.targetRole : "";
  const organizationId = typeof b.organizationId === "string" ? b.organizationId : "";
  if (!email || !displayName || !targetRole || !organizationId) {
    return NextResponse.json({ error: "invalidRequest" }, { status: 400 });
  }

  const result = await addMemberToOrganization(auth.client, {
    email,
    displayName,
    targetRole,
    organizationId,
  });
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 500 });
  }
  return NextResponse.json({ ok: true, userId: result.userId }, { status: 200 });
}
