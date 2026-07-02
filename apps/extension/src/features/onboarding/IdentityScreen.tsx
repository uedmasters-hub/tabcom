import { ArrowRight } from "lucide-react";

import AppShell from "../../components/layout/AppShell";
import ScreenFooter from "../../components/layout/ScreenFooter";
import ScreenHeader from "../../components/layout/ScreenHeader";
import { Button, Input, SectionLabel } from "../../components/ui";
import { useAppStore } from "../../stores/app.store";

export default function IdentityScreen() {
  const setScreen = useAppStore((state) => state.setScreen);

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        <ScreenHeader onBack={() => setScreen("visibility")} />

        <section className="flex flex-1 flex-col px-6">
          <SectionLabel>Identity</SectionLabel>

          <h1 className="mt-4 text-3xl font-bold tracking-tight">
            Create your identity
          </h1>

          <p className="mt-4 text-sm leading-7 text-slate-500">
            This information will be visible to people you connect with.
          </p>

          <div className="mt-10 space-y-5">
            <Input label="Display Name" placeholder="Ramesh Mandal" />
            <Input label="Username" placeholder="@ramesh" />
          </div>
        </section>

        <ScreenFooter>
          <Button
            fullWidth
            onClick={() => setScreen("avatar")}
            rightIcon={<ArrowRight size={18} />}
          >
            Continue
          </Button>
        </ScreenFooter>
      </div>
    </AppShell>
  );
}
