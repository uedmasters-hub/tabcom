import { Check, Globe, Lock } from "lucide-react";

import AppShell from "../../components/layout/AppShell";
import ScreenHeader from "../../components/layout/ScreenHeader";
import { OptionCard, SectionLabel } from "../../components/ui";
import { useAppStore } from "../../stores/app.store";
import {
  useProfileStore,
  type ProfileVisibility,
} from "../../stores/profile.store";

const options: Array<{
  id: ProfileVisibility;
  title: string;
  description: string;
  icon: typeof Globe;
}> = [
  {
    id: "public",
    title: "Public Profile",
    description: "Anyone can find and connect with you.",
    icon: Globe,
  },
  {
    id: "private",
    title: "Private Profile",
    description: "Only people you invite can connect.",
    icon: Lock,
  },
];

export default function VisibilityScreen() {
  const setScreen = useAppStore((state) => state.setScreen);
  const visibility = useProfileStore((state) => state.visibility);
  const setVisibility = useProfileStore((state) => state.setVisibility);

  const choose = (id: ProfileVisibility) => {
    setVisibility(id);
    setScreen("identity");
  };

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
            {options.map(({ id, title, description, icon: Icon }) => (
              <OptionCard
                key={id}
                title={title}
                description={description}
                icon={<Icon size={18} />}
                selected={visibility === id}
                trailing={
                  visibility === id ? (
                    <Check size={18} className="text-blue-600" />
                  ) : undefined
                }
                onClick={() => choose(id)}
              />
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
