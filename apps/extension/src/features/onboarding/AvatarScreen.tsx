import { Check } from "lucide-react";

import AppShell from "../../components/layout/AppShell";
import ScreenFooter from "../../components/layout/ScreenFooter";
import ScreenHeader from "../../components/layout/ScreenHeader";
import { Avatar, Button, SectionLabel } from "../../components/ui";
import { cn } from "../../lib/cn";
import { useAppStore } from "../../stores/app.store";
import { AVATAR_COLORS, useProfileStore } from "../../stores/profile.store";

export default function AvatarScreen() {
  const setScreen = useAppStore((state) => state.setScreen);

  const displayName = useProfileStore((state) => state.displayName);
  const avatarColor = useProfileStore((state) => state.avatarColor);
  const setAvatarColor = useProfileStore((state) => state.setAvatarColor);
  const completeProfile = useProfileStore((state) => state.completeProfile);

  const finish = () => {
    completeProfile();
    setScreen("workspace");
  };

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        <ScreenHeader onBack={() => setScreen("identity")} />

        <section className="flex flex-1 flex-col px-6">
          <SectionLabel>Profile</SectionLabel>

          <h1 className="mt-4 text-3xl font-bold tracking-tight">
            Choose your avatar
          </h1>

          <p className="mt-4 text-sm leading-7 text-slate-500">
            Pick a color for your initials. Photo upload arrives once
            accounts sync to the backend.
          </p>

          <div className="mt-10 flex justify-center">
            <Avatar name={displayName} color={avatarColor} size="xl" />
          </div>

          <div
            role="radiogroup"
            aria-label="Avatar color"
            className="mt-10 grid grid-cols-4 justify-items-center gap-4"
          >
            {AVATAR_COLORS.map(({ id, value }) => {
              const isSelected = value === avatarColor;

              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={id}
                  onClick={() => setAvatarColor(value)}
                  className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-full transition-transform hover:scale-105",
                    isSelected &&
                      "ring-2 ring-slate-900 ring-offset-2"
                  )}
                  style={{ backgroundColor: value }}
                >
                  {isSelected && <Check size={18} className="text-white" />}
                </button>
              );
            })}
          </div>
        </section>

        <ScreenFooter>
          <Button fullWidth onClick={finish}>
            Finish setup
          </Button>
        </ScreenFooter>
      </div>
    </AppShell>
  );
}
