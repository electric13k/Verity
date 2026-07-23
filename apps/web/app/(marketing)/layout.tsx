import "@/components/marketing/marketing.css";

// The public catalogue lives in its own route group so the 24KB marketing
// stylesheet never reaches the app bundle. The root layout still owns
// <html>/<body>, the theme boot, the ambient WebGL ground, and the auth
// provider; this layer only pulls in the marketing register and passes
// through. The signed-in workspace is a sibling group at /app.
export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
