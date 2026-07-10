import { ArrowRight, Clock } from "lucide-react";

import AppShell from "../../components/layout/AppShell";
import ScreenFooter from "../../components/layout/ScreenFooter";
import { Button } from "../../components/ui";
import { useAppStore } from "../../stores/app.store";

/**
 * Shown when WorkspaceScreen's guest-expiry watcher detects the
 * 30-minute session has ended. Local device data (contacts, messages,
 * board items) is untouched — only the ephemeral guest identity is
 * cleared — so this is a re-entry point, not a data-loss warning.
 */
export default function GuestExpiredScreen() {
  const setScreen = useAppStore((state) => state.setScreen);

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        <section className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <Clock size={24} />
          </span>

          <h1 className="mt-6 text-xl font-bold tracking-tight">
            Your guest session ended
          </h1>
          <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500">
            Guest sessions last 30 minutes. Start another one, or sign in for
            an account that doesn't expire.
          </p>
        </section>

        <ScreenFooter className="space-y-3">
          <Button
            fullWidth
            onClick={() => setScreen("guest-setup")}
            rightIcon={<ArrowRight size={18} />}
          >
            Start a new guest session
          </Button>
          <Button
            fullWidth
            variant="outline"
            onClick={() => setScreen("welcome")}
          >
            Sign in or register
          </Button>
        </ScreenFooter>
      </div>
    </AppShell>
  );
}
