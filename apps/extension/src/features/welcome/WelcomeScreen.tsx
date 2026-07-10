import { ArrowRight, Ticket, UserRound } from "lucide-react";

import AppShell from "../../components/layout/AppShell";
import ScreenHeader from "../../components/layout/ScreenHeader";
import { Button } from "../../components/ui";
import { useAppStore } from "../../stores/app.store";

export default function WelcomeScreen() {
  const setScreen = useAppStore((state) => state.setScreen);

  return (
    <AppShell>
      <ScreenHeader>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Tabcom</h1>
          <p className="mt-1 text-xs text-slate-500">
            Browser-first communication
          </p>
        </div>
      </ScreenHeader>

      <section className="flex flex-1 flex-col justify-center gap-3 px-6">
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
      </section>
    </AppShell>
  );
}
