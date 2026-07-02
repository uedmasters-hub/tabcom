import { ArrowRight, Building2, Globe, Mail } from "lucide-react";

import AppShell from "../../components/layout/AppShell";
import ScreenFooter from "../../components/layout/ScreenFooter";
import ScreenHeader from "../../components/layout/ScreenHeader";
import { OptionCard, SectionLabel } from "../../components/ui";
import { useAppStore } from "../../stores/app.store";

const providers = [
  { id: "google", label: "Continue with Google", icon: Globe },
  { id: "microsoft", label: "Continue with Microsoft", icon: Building2 },
  { id: "email", label: "Continue with Email", icon: Mail },
] as const;

export default function SignInScreen() {
  const setScreen = useAppStore((state) => state.setScreen);

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        <ScreenHeader onBack={() => setScreen("welcome")} />

        <section className="flex flex-1 flex-col px-6">
          <SectionLabel>Authentication</SectionLabel>

          <h1 className="mt-3 text-3xl font-bold tracking-tight">
            Continue to Tabcom
          </h1>

          <p className="mt-4 text-sm leading-7 text-slate-500">
            Sign in to sync conversations, browser activity, contacts and
            files across every device.
          </p>

          <div className="mt-10 flex flex-col gap-3">
            {providers.map(({ id, label, icon: Icon }) => (
              <OptionCard
                key={id}
                title={label}
                icon={<Icon size={18} />}
                trailing={<ArrowRight size={18} />}
                className="h-12 items-center py-0 font-medium"
                onClick={() => setScreen("visibility")}
              />
            ))}
          </div>
        </section>

        <ScreenFooter className="py-5 text-xs leading-6 text-slate-500">
          By continuing you agree to our Terms of Service and Privacy Policy.
        </ScreenFooter>
      </div>
    </AppShell>
  );
}
