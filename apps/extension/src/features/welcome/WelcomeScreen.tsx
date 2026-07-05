import { ArrowRight } from "lucide-react";

import AppShell from "../../components/layout/AppShell";
import ScreenHeader from "../../components/layout/ScreenHeader";
import { Button, SectionLabel } from "../../components/ui";
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

        <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500">
          v0.1
        </span>
      </ScreenHeader>

      <section className="flex flex-1 flex-col justify-center px-6">
        <SectionLabel className="mb-6">Introducing Tabcom</SectionLabel>

        <h2 className="max-w-xs text-4xl font-bold leading-tight tracking-tight">
          Your communication workspace inside the browser.
        </h2>

        <p className="mt-6 max-w-sm text-sm leading-7 text-slate-500">
          Chat, share tabs, exchange files, and collaborate without leaving the
          page you're working on.
        </p>

        <div className="mt-10">
          <Button
            onClick={() => setScreen("register")}
            rightIcon={<ArrowRight size={16} />}
          >
            Get started
          </Button>
        </div>
      </section>

      <footer className="flex items-center justify-between border-t border-slate-200 px-6 py-4 text-xs text-slate-500">
        <span>Privacy First</span>

        <button className="transition-colors hover:text-slate-900">
          Learn more
        </button>
      </footer>
    </AppShell>
  );
}
