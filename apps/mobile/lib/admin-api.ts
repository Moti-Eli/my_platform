/**
 * Client for the web app's privileged admin API (ARCHITECTURE.md #26).
 *
 * Mobile can't hold the secret key, so the two privileged operations (add user
 * to org, create org + first admin) and the all-orgs listing live behind
 * authenticated endpoints in apps/web. This helper attaches the user's Supabase
 * access token as a Bearer header; the server validates it, re-checks the
 * permission/owner on an RLS-scoped client, and only then uses the secret key.
 *
 * Error contract: bodies are `{ error: '<i18n key>' }` resolved in the endpoint's
 * namespace — `members` for /api/admin/members, `platform` for
 * /api/admin/organizations. A 401 means the session is dead (caller signs out and
 * routes to login). Network failures map to a generic connectivity key. Raw error
 * text is never surfaced.
 */
import { supabase } from "./supabase";

const BASE = process.env.EXPO_PUBLIC_API_URL;

export type AdminApiResult<T> =
  | { ok: true; data: T }
  /** Session is gone / token rejected (401, or no session) — sign out + login. */
  | { ok: false; kind: "sessionExpired" }
  /** A handled error; `errorKey` is an i18n key (endpoint namespace, or "common"). */
  | { ok: false; kind: "error"; errorKey: string };

async function request<T>(
  path: string,
  method: "GET" | "POST",
  body?: unknown
): Promise<AdminApiResult<T>> {
  if (!supabase || !BASE) return { ok: false, kind: "error", errorKey: "notConfigured" };

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, kind: "sessionExpired" };

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // No response at all — DNS/offline/wrong EXPO_PUBLIC_API_URL.
    return { ok: false, kind: "error", errorKey: "connectivity" };
  }

  if (res.status === 401) return { ok: false, kind: "sessionExpired" };

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON response.
  }

  if (!res.ok) {
    const errorKey =
      json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
        ? (json as { error: string }).error
        : "connectivity";
    return { ok: false, kind: "error", errorKey };
  }

  return { ok: true, data: (json ?? {}) as T };
}

export interface AddMemberBody {
  email: string;
  displayName: string;
  targetRole: "admin" | "member";
  organizationId: string;
}

export interface CreateOrgBody {
  organizationName: string;
  adminEmail: string;
  adminDisplayName: string;
}

export interface OrgListItem {
  id: string;
  name: string;
  memberCount: number;
  createdAt: string;
}

export const adminApi = {
  /** Endpoint namespace for errors: "members". */
  addMember: (body: AddMemberBody) =>
    request<{ ok: true; userId: string }>("/api/admin/members", "POST", body),

  /** Endpoint namespace for errors: "platform". */
  createOrganization: (body: CreateOrgBody) =>
    request<{ ok: true; organizationId: string; adminUserId: string; tempPassword: string | null }>(
      "/api/admin/organizations",
      "POST",
      body
    ),

  /** Endpoint namespace for errors: "platform". */
  listOrganizations: () =>
    request<{ ok: true; organizations: OrgListItem[] }>("/api/admin/organizations", "GET"),
};
