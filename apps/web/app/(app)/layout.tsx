import { AppShell } from "@/components/shell/AppShell";
import { AppProviders } from "@/lib/store";

// The signed-in app: the chat store and the floating glass shell wrap every
// in-app surface. Public routes (the shared transcript at /t) live outside
// this group and render standalone, so a share never loads the workspace.
export default function AppGroupLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AppProviders>
      <AppShell>{children}</AppShell>
    </AppProviders>
  );
}
