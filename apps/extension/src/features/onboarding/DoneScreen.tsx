import { ArrowRight, PartyPopper } from "lucide-react";

import AppShell from "../../components/layout/AppShell";
import ScreenFooter from "../../components/layout/ScreenFooter";
import { Avatar, Button } from "../../components/ui";
import { useAppStore } from "../../stores/app.store";
import { useProfileStore } from "../../stores/profile.store";

/**
 * Final step — arrival, not another form. Marking the profile
 * complete happens HERE, not at registration, so someone who closes
 * the extension mid-onboarding lands back on Register/Profile instead
 * of a half-finished Workspace.
 */
export default function DoneScreen() {
  const setScreen = useAppStore((state) => state.setScreen);
  const displayName = useProfileStore((state) => state.displayName);
  const avatarColor = useProfileStore((state) => state.avatarColor);
  const completeProfile = useProfileStore((state) => state.completeProfile);

  const start = () => {
    completeProfile();
    setScreen("workspace");
  };

  return (
    <AppShell>
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <Avatar name={displayName || "You"} color={avatarColor} size="xl" />

        <div className="mt-6 flex items-center gap-2 text-blue-600">
          <PartyPopper size={20} />
          <span className="text-xs font-bold uppercase tracking-wide">You're all set</span>
        </div>

        <h1 className="mt-3 text-2xl font-bold tracking-tight">
          Welcome, {displayName.split(" ")[0] || "there"}.
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Your account is ready — everything works right now. Confirm your
          email whenever you like from Settings to protect your username.
        </p>
      </div>

      <ScreenFooter>
        <Button fullWidth onClick={start} rightIcon={<ArrowRight size={18} />}>
          Start using Tabcom
        </Button>
      </ScreenFooter>
    </AppShell>
  );
}
