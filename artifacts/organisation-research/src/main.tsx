import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider, SignIn, useAuth, UserButton } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { App } from "./App";
import { api } from "./api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  SpringpodLogo,
  Alert,
  AlertDescription,
  Skeleton,
} from "./ui";
import "./index.css";
function Authenticated() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <Loading />;
  if (!isSignedIn)
    return (
      <div className="min-h-dvh bg-background flex flex-col gap-8 items-center justify-center p-6">
        <SpringpodLogo className="w-40" />
        <h1 className="text-h4">Organisation Research</h1>
        <p className="text-p3 text-muted-foreground">
          Sign in with your organisation’s approved account.
        </p>
        <SignIn routing="hash" forceRedirectUrl="/" signUpUrl={undefined} />
      </div>
    );
  return <App accountControl={<UserButton />} />;
}
/** Shown only while configuration and the session are being fetched. */
function Loading() {
  return (
    <main
      className="min-h-dvh bg-background flex flex-col items-center justify-center gap-6 p-6"
      aria-busy="true"
      aria-live="polite"
    >
      <SpringpodLogo className="w-40" />
      <Skeleton className="h-4 w-48" />
      <p className="text-p4 text-muted-foreground">Loading…</p>
    </main>
  );
}
/** Shown when the workspace cannot be opened until an administrator acts. */
function Setup({ title, error }: { title: string; error?: string }) {
  return (
    <main className="min-h-dvh bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <SpringpodLogo className="w-40 mb-8" />
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-p3">
            Your team’s evidence workspace for better career experiences.
          </p>
          {error && (
            <Alert>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <p className="text-p4 text-muted-foreground">
            An administrator needs to configure Clerk SSO and workspace
            membership before internal research can be accessed. See the setup
            guide supplied with this project.
          </p>
          <Button variant="outline" onClick={() => location.reload()}>
            Check setup again
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
function Root() {
  const [config, setConfig] = useState<any>();
  const [error, setError] = useState("");
  useEffect(() => {
    api("/config")
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, []);
  if (error) return <Setup title="Could not connect" error={error} />;
  if (!config) return <Loading />;
  if (config.preview) return <App preview />;
  if (!config.configured)
    return <Setup title="Connect your team’s Clerk workspace" />;
  // Replit-managed Clerk: the key is resolved from the current hostname (custom
  // domains map to their own key) and, in production, Clerk's Frontend API is
  // reached through this origin's /api/__clerk proxy. Both are empty in
  // development, where Clerk's development instance is used directly.
  const publishableKey = publishableKeyFromHost(
    window.location.hostname,
    config.clerkPublishableKey,
  );
  const proxyUrl =
    import.meta.env.VITE_CLERK_PROXY_URL ||
    (config.clerkProxyPath
      ? `${window.location.origin}${config.clerkProxyPath}`
      : undefined);
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      proxyUrl={proxyUrl}
      afterSignOutUrl="/"
    >
      <Authenticated />
    </ClerkProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Root />);
