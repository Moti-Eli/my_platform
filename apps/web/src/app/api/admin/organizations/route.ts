import { NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/admin/api-auth";
import { createOrganizationForOwner } from "@/lib/admin/create-organization";
import { listOrganizations } from "@/lib/admin/list-organizations";

/**
 * POST /api/admin/organizations — create an organization + its first admin
 * (mobile-facing, platform-owner only).
 *
 * Auth: `Authorization: Bearer <supabase access_token>`. The token is validated
 * server-side and a user-scoped (RLS) client is built from it; the shared
 * `createOrganizationForOwner` then re-verifies `isPlatformOwner` (the security
 * boundary) before the secret key is touched. See ARCHITECTURE.md #26.
 *
 * Responses are `{ error: '<i18n key under "platform">' }` (never raw messages):
 *   401 unauthorized · 400 invalidRequest|invalidOrgName|invalidEmail|invalidName ·
 *   403 notAllowed · 409 emailExists · 503 notConfigured · 500 createFailed ·
 *   200 { ok: true, organizationId, adminUserId, tempPassword? }.
 *
 * GET — list every organization (id, name, memberCount, createdAt; active only),
 * platform-owner only. Same Bearer-token auth + owner re-check (the shared
 * `listOrganizations` is the boundary). Responses are `{ error: '<i18n key under
 * "platform">' }`: 401 unauthorized · 403 notAllowed · 503 notConfigured ·
 * 500 loadError · 200 { ok: true, organizations }.
 *
 * Other methods get 405 automatically (only POST + GET are exported).
 */
const STATUS: Record<string, number> = {
  invalidRequest: 400,
  invalidOrgName: 400,
  invalidEmail: 400,
  invalidName: 400,
  notAllowed: 403,
  emailExists: 409,
  notConfigured: 503,
  createFailed: 500,
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
  const organizationName = typeof b.organizationName === "string" ? b.organizationName : "";
  const adminEmail = typeof b.adminEmail === "string" ? b.adminEmail : "";
  const adminDisplayName = typeof b.adminDisplayName === "string" ? b.adminDisplayName : "";
  if (!organizationName || !adminEmail || !adminDisplayName) {
    return NextResponse.json({ error: "invalidRequest" }, { status: 400 });
  }

  const result = await createOrganizationForOwner(auth.client, {
    organizationName,
    adminEmail,
    adminDisplayName,
  });
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 500 });
  }
  return NextResponse.json(
    {
      ok: true,
      organizationId: result.organizationId,
      adminUserId: result.adminUserId,
      tempPassword: result.tempPassword,
    },
    { status: 200 }
  );
}

const GET_STATUS: Record<string, number> = {
  notAllowed: 403,
  notConfigured: 503,
  loadError: 500,
};

export async function GET(req: Request): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const result = await listOrganizations(auth.client);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: GET_STATUS[result.error] ?? 500 });
  }
  return NextResponse.json({ ok: true, organizations: result.organizations }, { status: 200 });
}
