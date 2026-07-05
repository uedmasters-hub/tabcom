import { ArrowRight, Check, Globe, Lock } from "lucide-react";

import AppShell from "../../components/layout/AppShell";
import ScreenFooter from "../../components/layout/ScreenFooter";
import ScreenHeader from "../../components/layout/ScreenHeader";
import { Avatar, Button, SectionLabel } from "../../components/ui";
import { cn } from "../../lib/cn";
import { useAppStore } from "../../stores/app.store";
import {
  AVATAR_COLORS,
  useProfileStore,
  type ProfileVisibility,
} from "../../stores/profile.store";

/**
 * Second step of the lean flow — purely cosmetic/preference, nothing
 * here blocks using the product. A profile photo can be added later
 * from Settings; this screen only needs a color so avatars never look
 * broken with nothing set at all.
 */
export default function ProfileScreen() {
  const setScreen = useAppStore((state) => state.setScreen);
  const displayName = useProfileStore((state) => state.displayName);
  const avatarColor = useProfileStore((state) => state.avatarColor);
  const visibility = useProfileStore((state) => state.visibility);
  const setAvatarColor = useProfileStore((state) => state.setAvatarColor);
  const setVisibility = useProfileStore((state) => state.setVisibility);

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        <ScreenHeader onBack={() => setScreen("register")} />

        <section className="flex flex-1 flex-col px-6">
          <SectionLabel>Make it yours</SectionLabel>
          <h1 className="mt-3 text-2xl font-bold tracking-tight">
            Pick a color for your avatar.
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            You can add a photo anytime from Settings.
          </p>

          <div className="mt-8 flex justify-center">
            <Avatar name={displayName || "You"} color={avatarColor} size="xl" />
          </div>

          <div
            role="radiogroup"
            aria-label="Avatar color"
            className="mt-6 flex flex-wrap justify-center gap-2.5"
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
                    "flex h-9 w-9 items-center justify-center rounded-full transition-transform hover:scale-105",
                    isSelected && "ring-2 ring-slate-900 ring-offset-2"
                  )}
                  style={{ backgroundColor: value }}
                >
                  {isSelected && <Check size={14} className="text-white" />}
                </button>
              );
            })}
          </div>

          <SectionLabel className="mt-10">Who can find you?</SectionLabel>
          <div className="mt-2 flex gap-2">
            {(
              [
                { id: "public" as ProfileVisibility, label: "Public", icon: Globe },
                { id: "private" as ProfileVisibility, label: "Private", icon: Lock },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setVisibility(id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold transition",
                  visibility === id
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                )}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
        </section>

        <ScreenFooter>
          <Button fullWidth onClick={() => setScreen("done")} rightIcon={<ArrowRight size={18} />}>
            Continue
          </Button>
        </ScreenFooter>
      </div>
    </AppShell>
  );
}
