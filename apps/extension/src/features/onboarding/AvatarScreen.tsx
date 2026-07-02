import AppShell from "../../components/layout/AppShell";
import ScreenHeader from "../../components/layout/ScreenHeader";
import { SectionLabel } from "../../components/ui";
import { useAppStore } from "../../stores/app.store";

export default function AvatarScreen() {
  const setScreen = useAppStore((state) => state.setScreen);

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        <ScreenHeader onBack={() => setScreen("identity")} />

        <section className="flex flex-1 flex-col justify-center px-6 pb-16">
          <SectionLabel>Profile</SectionLabel>

          <h1 className="mt-4 text-3xl font-bold tracking-tight">
            Choose your avatar
          </h1>

          <p className="mt-4 text-sm leading-7 text-slate-500">
            Avatar selection lands in the next milestone (M2), together with
            form validation and profile persistence.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
