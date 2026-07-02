import { ArrowRight } from "lucide-react";
import { useAppStore } from "../../stores/app.store";
import AppShell from "../../components/layout/AppShell";

export default function WelcomeScreen() {
  const setScreen = useAppStore((state) => state.setScreen);

  return (
    <AppShell>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Tabcom
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Browser-first communication
          </p>
        </div>

        <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500">
          v0.1
        </span>
      </header>

      {/* Hero */}
      <section className="flex flex-1 flex-col justify-center px-6">
        <span className="mb-6 text-xs font-semibold uppercase tracking-[0.24em] text-blue-600">
          Introducing Tabcom
        </span>

        <h2 className="max-w-xs text-4xl font-bold leading-tight tracking-tight">
          Your communication workspace inside the browser.
        </h2>

        <p className="mt-6 max-w-sm text-sm leading-7 text-slate-500">
          Chat, share tabs, exchange files, and collaborate without leaving the
          page you're working on.
        </p>

        <div className="mt-10">
          <button
            onClick={() => setScreen("signin")}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-all hover:bg-slate-800"
          >
            Continue
            <ArrowRight size={16} />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="flex items-center justify-between border-t border-slate-200 px-6 py-4 text-xs text-slate-500">
        <span>Privacy First</span>

        <button className="transition-colors hover:text-slate-900">
          Learn more
        </button>
      </footer>
    </AppShell>
  );
}