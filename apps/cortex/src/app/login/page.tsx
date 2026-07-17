/**
 * Login — THE ONLY PUBLIC PAGE IN CORTEX.
 *
 * It calls no guard, deliberately and necessarily: this page is how a session is
 * obtained, so guarding it would be a redirect loop. Every other page under
 * src/app calls requireSession() itself (see src/lib/session.ts for the full
 * per-page table).
 *
 * A server component with a client form child — the same split every protected
 * route uses, for a different reason: here it is `useActionState` that needs the
 * client, not a guard that needs the server.
 */
import { LoginTitle } from "./LoginTitle";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-lg px-lg py-xl">
      <LoginTitle />
      <LoginForm />
    </main>
  );
}
