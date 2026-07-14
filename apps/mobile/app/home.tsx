import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { HomeView } from "@/home";

/**
 * Home route — thin shell only (FEATURES.md): session gate + render. The view
 * itself lives in the `home` feature folder. If the session is gone (e.g.
 * logout elsewhere), bounce to the logged-out entry point.
 */
export default function HomeScreen() {
  const { session } = useAuth();

  if (!session) {
    return <Redirect href="/landing" />;
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <HomeView user={session.user} />
    </>
  );
}
