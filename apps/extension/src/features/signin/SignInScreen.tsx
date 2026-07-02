import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Globe,
  Mail,
} from "lucide-react";

import AppShell from "../../components/layout/AppShell";
import { useAppStore } from "../../stores/app.store";

export default function SignInScreen() {
  const setScreen = useAppStore((state) => state.setScreen);

  return (
    <AppShell>
      <div className="flex h-full flex-col">

        {/* Header */}

        <header className="flex items-center px-6 py-5">
          <button
            onClick={() => setScreen("welcome")}
            className="flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-900"
          >
            <ArrowLeft size={18} />
            Back
          </button>
        </header>

        {/* Content */}

        <section className="flex flex-1 flex-col px-6">

          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">
            Authentication
          </span>

          <h1 className="mt-3 text-3xl font-bold tracking-tight">
            Continue to Tabcom
          </h1>

          <p className="mt-4 text-sm leading-7 text-slate-500">
            Sign in to sync conversations, browser activity,
            contacts and files across every device.
          </p>

          <div className="mt-10 flex flex-col gap-3">

            <button
              className="flex h-12 items-center justify-between rounded-xl border border-slate-200 px-4 transition hover:border-slate-300 hover:bg-slate-50"
              onClick={() => setScreen("visibility")}
            >
              <div className="flex items-center gap-3">
                <Globe size={18} />
                <span className="font-medium">
                  Continue with Google
                </span>
              </div>

              <ArrowRight size={18} />
            </button>

            <button
              className="flex h-12 items-center justify-between rounded-xl border border-slate-200 px-4 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <div className="flex items-center gap-3">
                <Building2 size={18} />
                <span className="font-medium">
                  Continue with Microsoft
                </span>
              </div>

              <ArrowRight size={18} />
            </button>

            <button
              className="flex h-12 items-center justify-between rounded-xl border border-slate-200 px-4 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <div className="flex items-center gap-3">
                <Mail size={18} />
                <span className="font-medium">
                  Continue with Email
                </span>
              </div>

              <ArrowRight size={18} />
            </button>

          </div>

        </section>

        {/* Footer */}

        <footer className="border-t border-slate-200 px-6 py-5 text-xs leading-6 text-slate-500">
          By continuing you agree to our Terms of Service and
          Privacy Policy.
        </footer>

      </div>
    </AppShell>
  );
}