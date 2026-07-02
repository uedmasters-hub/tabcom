import { ArrowLeft, ArrowRight } from "lucide-react";

import AppShell from "../../components/layout/AppShell";
import { useAppStore } from "../../stores/app.store";

export default function IdentityScreen() {
  const setScreen = useAppStore((state) => state.setScreen);

  return (
    <AppShell>
      <div className="flex h-full flex-col">

        <header className="flex items-center px-6 py-5">
          <button
            onClick={() => setScreen("visibility")}
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft size={18} />
            Back
          </button>
        </header>

        <section className="flex flex-1 flex-col px-6">

          <span className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-600">
            Identity
          </span>

          <h1 className="mt-4 text-3xl font-bold tracking-tight">
            Create your identity
          </h1>

          <p className="mt-4 text-sm leading-7 text-slate-500">
            This information will be visible to people you connect with.
          </p>

          <div className="mt-10 space-y-5">

            <div>
              <label className="mb-2 block text-sm font-medium">
                Display Name
              </label>

              <input
                placeholder="Ramesh Mandal"
                className="h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                Username
              </label>

              <input
                placeholder="@ramesh"
                className="h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-blue-500"
              />
            </div>

          </div>

        </section>

        <footer className="border-t border-slate-200 p-6">
          <button
            onClick={() => setScreen("avatar")}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800"
          >
            Continue
            <ArrowRight size={18} />
          </button>
        </footer>

      </div>
    </AppShell>
  );
}