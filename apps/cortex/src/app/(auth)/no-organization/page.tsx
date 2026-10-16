/**
 * "You are in no organization" — the explicit state for an authenticated user
 * with zero active memberships. `requireSession()` redirects here rather than
 * letting a dashboard render empty.
 *
 * PUBLIC-BY-NECESSITY, like /login, and for the same structural reason: it is
 * where requireSession() SENDS you, so calling requireSession() here would be an
 * infinite redirect. It discloses nothing — it reads no identity, takes no
 * props, and says the same sentence to everyone, including a logged-out visitor
 * who types the URL. There is nothing here to protect.
 *
 * UNREACHABLE TODAY: no self-service signup exists, so every account is
 * provisioned WITH a membership (add-member, or createOrganizationWithFirstAdmin).
 * This exists for the day signup lands — when a blank dashboard would look like a
 * bug, and this says what is actually true instead.
 */
import { NoOrganizationView } from "./NoOrganizationView";

export default function NoOrganizationPage() {
  return <NoOrganizationView />;
}
