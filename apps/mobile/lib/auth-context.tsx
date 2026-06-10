/**
 * App-wide auth state, derived from the shared Supabase client.
 *
 * On launch we read the persisted session out of AsyncStorage via
 * `getSession()` and then subscribe to auth changes. `loading` is true only
 * while that first read is in flight — screens show a spinner during it, and
 * (per the splash lesson) the splash is hidden on mount regardless, so a hung
 * read can never strand the user on the splash screen.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "./supabase";

type Client = NonNullable<typeof supabase>;
type Session = Awaited<
  ReturnType<Client["auth"]["getSession"]>
>["data"]["session"];

interface AuthState {
  session: Session | null;
  loading: boolean;
  /** False when Supabase env vars are missing. */
  configured: boolean;
}

const AuthContext = createContext<AuthState>({
  session: null,
  loading: true,
  configured: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setSession(data.session);
      })
      .catch(() => {
        // Treat a failed read as "not logged in" rather than hanging.
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading, configured: Boolean(supabase) }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
