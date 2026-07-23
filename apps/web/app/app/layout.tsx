import { AppShell } from "@/components/shell/AppShell";
import { AppProviders } from "@/lib/store";
import { AuthGate } from "@/components/auth/AuthGate";

// The signed-in app: the auth gate guards the group (rendering the sign-in
// screen when Supabase is configured and no one is signed in, the app
// otherwise), then the chat store and the floating glass shell wrap every
// in-app surface. Public routes (the shared transcript at /t) live outside
// this group and render standalone, so a share never loads the workspace.
export default function AppGroupLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthGate>
      <AppProviders>
        <AppShell>{children}</AppShell>
      </AppProviders>
    </AuthGate>
  );
}
