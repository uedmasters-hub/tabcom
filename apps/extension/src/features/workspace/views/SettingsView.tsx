import { Check, Globe, Lock, LogOut } from "lucide-react";

import {
  Avatar,
  Button,
  OptionCard,
  SectionLabel,
} from "../../../components/ui";
import { useAppStore } from "../../../stores/app.store";
import {
  useProfileStore,
  type ProfileVisibility,
} from "../../../stores/profile.store";

const visibilityOptions: Array<{
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

export default function SettingsView() {
  const setScreen = useAppStore((state) => state.setScreen);

  const displayName = useProfileStore((state) => state.displayName);
  const username = useProfileStore((state) => state.username);
  const visibility = useProfileStore((state) => state.visibility);
  const avatarColor = useProfileStore((state) => state.avatarColor);
  const setVisibility = useProfileStore((state) => state.setVisibility);
  const resetProfile = useProfileStore((state) => state.resetProfile);

  const signOut = () => {
    resetProfile();
    setScreen("welcome");
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-6">
      {/* Profile card */}
      <div className="flex items-center gap-4 rounded-xl border border-slate-200 p-4">
        <Avatar name={displayName} color={avatarColor} size="lg" />

        <div className="min-w-0">
          <p className="truncate font-semibold">{displayName}</p>
          <p className="truncate text-sm text-slate-500">@{username}</p>
        </div>
      </div>

      {/* Visibility */}
      <SectionLabel className="mt-8">Discovery</SectionLabel>

      <div className="mt-4 flex flex-col gap-3">
        {visibilityOptions.map(({ id, title, description, icon: Icon }) => (
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
            onClick={() => setVisibility(id)}
          />
        ))}
      </div>

      {/* Account */}
      <SectionLabel className="mt-8">Account</SectionLabel>

      <Button
        variant="outline"
        fullWidth
        className="mt-4 text-red-600 hover:border-red-200 hover:bg-red-50"
        leftIcon={<LogOut size={16} />}
        onClick={signOut}
      >
        Sign out
      </Button>

      <p className="mt-8 text-center text-xs text-slate-400">
        Tabcom v0.1 — Browser-first communication
      </p>
    </div>
  );
}
