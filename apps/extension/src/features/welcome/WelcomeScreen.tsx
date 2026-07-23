import { ArrowRight, Ticket, UserRound } from "lucide-react";

import AppShell from "../../components/layout/AppShell";
import { Illustration, Button } from "../../components/ui";
import { useAppStore } from "../../stores/app.store";

export default function WelcomeScreen() {
  const setScreen = useAppStore((state) => state.setScreen);

  return (
    <AppShell>
      <div className="flex h-full flex-col overflow-y-auto px-6 py-8">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          {/* Brand mark, not a generated avatar — the identity should be
              the real logo everywhere it appears. */}
          <img
            src="/icon/128.png"
            alt=""
            aria-hidden="true"
            className="h-14 w-14 rounded-2xl"
          />

          <h1 className="mt-5 text-2xl font-bold tracking-tight">
            Meet Tabcom
          </h1>
          <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500">
            For teams, communities, and collaboration.
          </p>

          <div className="mt-6">
            <Illustration
              name="hero-logo.png"
              alt="The Tabcom mark — a speech bubble formed from a twisting ribbon"
              size={180}
            />
          </div>

          <p className="mt-6 text-sm text-slate-500">
            Made for teams. Built for everyone.
          </p>
        </div>

        <div className="flex flex-col gap-3 pt-6">
          <Button
            fullWidth
            onClick={() => setScreen("register")}
            leftIcon={<Ticket size={16} />}
            rightIcon={<ArrowRight size={16} />}
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
            className="mt-1 w-full text-center text-xs font-medium text-slate-400 transition hover:text-slate-600"
          >
            Already have an account? Sign in
          </button>
        </div>
      </div>
    </AppShell>
  );
}
