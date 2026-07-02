import {
  ArrowLeft,
  Mail,
  Globe,
  Building2,
} from "lucide-react";

import { useAppStore } from "../../stores/app.store";
import AppShell from "../../components/layout/AppShell";

export default function SignInScreen() {
  const setScreen = useAppStore((s) => s.setScreen);

  return (
    <AppShell>

      <header className="px-6 pt-6">
        <button
          onClick={() => setScreen("welcome")}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft size={18} />
          Back
        </button>
      </header>

      <section className="flex flex-1 flex-col justify-center px-6">

        <span className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-600">
          Authentication
        </span>

        <h1 className="mt-4 text-3xl font-bold">
          Continue to Tabcom
        </h1>

        <p className="mt-4 text-sm leading-7 text-slate-500">
          Sign in to sync conversations, browser activity,
          contacts and files across devices.
        </p>

        <div className="mt-10 flex flex-col gap-3">

          <button className="flex h-12 items-center justify-center gap-3 rounded-xl border border-slate-200 hover:bg-slate-50">
            <Globe size={18} />
            Continue with Google
          </button>

          <button className="flex h-12 items-center justify-center gap-3 rounded-xl border border-slate-200 hover:bg-slate-50">
            <Building2 size={18} />
            Continue with Microsoft
          </button>

          <button className="flex h-12 items-center justify-center gap-3 rounded-xl border border-slate-200 hover:bg-slate-50">
            <Mail size={18} />
            Continue with Email
          </button>

        </div>

      </section>

      <footer className="px-6 pb-6 text-center text-xs text-slate-400">
        By continuing you agree to our
        Terms and Privacy Policy.
      </footer>

    </AppShell>
  );
}