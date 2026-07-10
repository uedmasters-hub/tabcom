import { ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";

import AppShell from "../../components/layout/AppShell";
import ScreenFooter from "../../components/layout/ScreenFooter";
import ScreenHeader from "../../components/layout/ScreenHeader";
import { Avatar, Button, Input, SectionLabel } from "../../components/ui";
import { generateGuestUsername } from "../../lib/guest-username";
import { useAppStore } from "../../stores/app.store";
import { useProfileStore } from "../../stores/profile.store";

/**
 * Guest entry point: display name only — no username field, no email,
 * no invite code. A unique username is generated automatically behind
 * the scenes (see lib/guest-username.ts). The session lasts 30 minutes
 * (see WorkspaceScreen's expiry watcher) and never creates a server
 * account; upgrading to a real one goes through the same invite-gated
 * RegisterScreen as everyone else.
 */
export default function GuestSetupScreen() {
  const setScreen = useAppStore((state) => state.setScreen);
  const goBack = useAppStore((state) => state.goBack);
  const avatarColor = useProfileStore((state) => state.avatarColor);
  const startGuestSession = useProfileStore((state) => state.startGuestSession);
  const completeProfile = useProfileStore((state) => state.completeProfile);

  const [displayName, setDisplayName] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = displayName.trim().length >= 2;

  const submit = async () => {
    if (!canSubmit || starting) return;
    setStarting(true);
    setError(null);

    try {
      const username = await generateGuestUsername();
      startGuestSession({ displayName: displayName.trim(), username });
      completeProfile();
      setScreen("workspace");
    } catch {
      setError("Couldn't start a guest session — try again.");
      setStarting(false);
    }
  };

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        <ScreenHeader onBack={() => goBack("welcome")} />

        <section className="flex flex-1 flex-col px-6">
          <SectionLabel>Try it out</SectionLabel>
          <h1 className="mt-3 text-2xl font-bold tracking-tight">
            What should people call you?
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            A 30-minute guest session — no email, no account. Your username is
            assigned automatically.
          </p>

          <div className="mt-8 flex justify-center">
            <Avatar name={displayName || "Guest"} color={avatarColor} size="xl" />
          </div>

          <div className="mt-6">
            <Input
              label="Display name"
              placeholder="Your name"
              autoFocus
              autoComplete="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
              error={error ?? undefined}
            />
          </div>
        </section>

        <ScreenFooter>
          <Button
            fullWidth
            disabled={!canSubmit || starting}
            onClick={() => void submit()}
            rightIcon={starting ? undefined : <ArrowRight size={18} />}
          >
            {starting ? (
              <span className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                Starting your session…
              </span>
            ) : (
              "Start guest session"
            )}
          </Button>

          <button
            type="button"
            onClick={() => setScreen("register")}
            className="mt-3 w-full text-center text-xs font-medium text-slate-400 transition hover:text-slate-600"
          >
            Have an invite? Create a real account instead
          </button>
        </ScreenFooter>
      </div>
    </AppShell>
  );
}
