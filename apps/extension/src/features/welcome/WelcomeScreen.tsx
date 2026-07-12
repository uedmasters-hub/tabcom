import { ArrowRight, Ticket, UserRound } from "lucide-react";

import AppShell from "../../components/layout/AppShell";
import { Avatar, Illustration, Button } from "../../components/ui";
import { useAppStore } from "../../stores/app.store";

export default function WelcomeScreen() {
  const setScreen = useAppStore((state) => state.setScreen);

  return (
    <AppShell>
      <div className="flex h-full flex-col overflow-y-auto px-6 py-8">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <Avatar name="Tabcom" color="#2563EB" size="lg" />

          <h1 className="mt-6 text-2xl font-bold tracking-tight">
            Start your journey
          </h1>
          <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500">
            with Tabcom — a new era of browser-first communication.
          </p>

          <div className="mt-8">
            <Illustration
              name="welcome.png"
              alt="Illustration of secure messaging and account credentials"
              size={200}
            />
          </div>
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
