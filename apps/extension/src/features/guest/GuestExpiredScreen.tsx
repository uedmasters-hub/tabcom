import { ArrowRight, Ticket, UserRound } from "lucide-react";

import AppShell from "../../components/layout/AppShell";
import ScreenFooter from "../../components/layout/ScreenFooter";
import { Button, Illustration } from "../../components/ui";
import { useAppStore } from "../../stores/app.store";

/**
 * Shown when the guest 30-minute session ends. All guest-local data
 * (contacts, messages, communities) has already been wiped — the next
 * guest starts from a clean slate.
 */
export default function GuestExpiredScreen() {
  const setScreen = useAppStore((state) => state.setScreen);

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        <section className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <Illustration
            name="session-timeout.png"
            alt="Illustration of an hourglass next to a locked profile"
            size={168}
          />

          <div className="mt-6 w-full max-w-xs rounded-2xl border border-slate-200 bg-slate-50 px-5 py-5">
            <h1 className="text-lg font-bold tracking-tight">
              Guest session ended
            </h1>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Guest sessions last 30 minutes. Your guest data on this device
              has been cleared — the next session starts fresh. Jump back in
              below, or sign in for an account that doesn&apos;t expire.
            </p>
          </div>
        </section>

        <ScreenFooter className="space-y-3">
          <Button
            fullWidth
            onClick={() => setScreen("register")}
            leftIcon={<Ticket size={16} />}
            rightIcon={<ArrowRight size={18} />}
          >
            Join with an invite code
          </Button>
          <Button
            fullWidth
            variant="outline"
            onClick={() => setScreen("guest-setup")}
            leftIcon={<UserRound size={16} />}
          >
            Continue as guest
          </Button>
          <button
            type="button"
            onClick={() => setScreen("signin")}
            className="w-full text-center text-xs font-medium text-slate-400 transition hover:text-slate-600"
          >
            Already have an account? Sign in
          </button>
        </ScreenFooter>
      </div>
    </AppShell>
  );
}
