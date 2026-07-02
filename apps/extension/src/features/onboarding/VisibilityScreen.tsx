import AppShell from "../../components/layout/AppShell";
import { useAppStore } from "../../stores/app.store";

export default function VisibilityScreen() {
  const setScreen = useAppStore((state) => state.setScreen);

  return (
    <AppShell>
      <div className="flex flex-1 flex-col justify-center px-6">
        <span className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-600">
          Profile
        </span>

        <h1 className="mt-4 text-3xl font-bold">
          Who can discover you?
        </h1>

        <p className="mt-4 text-sm text-slate-500">
          Choose how people can connect with you on Tabcom.
        </p>

        <div className="mt-10 flex flex-col gap-4">
          <button
            className="rounded-xl border border-slate-200 p-4 text-left hover:border-slate-400"
            onClick={() => setScreen("identity")}
          >
            <div className="font-semibold">Public Profile</div>
            <div className="mt-1 text-sm text-slate-500">
              Anyone can find and connect with you.
            </div>
          </button>

          <button
            className="rounded-xl border border-slate-200 p-4 text-left hover:border-slate-400"
            onClick={() => setScreen("identity")}
          >
            <div className="font-semibold">Private Profile</div>
            <div className="mt-1 text-sm text-slate-500">
              Only people you invite can connect.
            </div>
          </button>
        </div>
      </div>
    </AppShell>
  );
}