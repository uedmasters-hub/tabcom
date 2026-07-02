import { Globe, Lock } from "lucide-react";

import AppShell from "../../components/layout/AppShell";
import ScreenHeader from "../../components/layout/ScreenHeader";
import { OptionCard, SectionLabel } from "../../components/ui";
import { useAppStore } from "../../stores/app.store";

export default function VisibilityScreen() {
  const setScreen = useAppStore((state) => state.setScreen);

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        <ScreenHeader onBack={() => setScreen("signin")} />

        <section className="flex flex-1 flex-col justify-center px-6 pb-16">
          <SectionLabel>Profile</SectionLabel>

          <h1 className="mt-4 text-3xl font-bold">Who can discover you?</h1>

          <p className="mt-4 text-sm text-slate-500">
            Choose how people can connect with you on Tabcom.
          </p>

          <div className="mt-10 flex flex-col gap-4">
            <OptionCard
              title="Public Profile"
              description="Anyone can find and connect with you."
              icon={<Globe size={18} />}
              onClick={() => setScreen("identity")}
            />

            <OptionCard
              title="Private Profile"
              description="Only people you invite can connect."
              icon={<Lock size={18} />}
              onClick={() => setScreen("identity")}
            />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
