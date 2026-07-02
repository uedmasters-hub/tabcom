import { Inbox, LogOut } from "lucide-react";

import AppShell from "../../components/layout/AppShell";
import ScreenHeader from "../../components/layout/ScreenHeader";
import { Avatar, Button, SectionLabel } from "../../components/ui";
import { useAppStore } from "../../stores/app.store";
import { useProfileStore } from "../../stores/profile.store";

/**
 * Placeholder workspace proving onboarding completion + persistence.
 * The real shell (Inbox / Contacts / Communities / Settings) is M3.
 */
export default function WorkspaceScreen() {
  const setScreen = useAppStore((state) => state.setScreen);

  const displayName = useProfileStore((state) => state.displayName);
  const username = useProfileStore((state) => state.username);
  const visibility = useProfileStore((state) => state.visibility);
  const avatarColor = useProfileStore((state) => state.avatarColor);
  const resetProfile = useProfileStore((state) => state.resetProfile);

  const signOut = () => {
    resetProfile();
    setScreen("welcome");
  };

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        <ScreenHeader>
          <div className="flex items-center gap-3">
            <Avatar name={displayName} color={avatarColor} size="md" />

            <div>
              <p className="text-sm font-semibold leading-tight">
                {displayName}
              </p>
              <p className="text-xs text-slate-500">@{username}</p>
            </div>
          </div>

          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium capitalize text-slate-500">
            {visibility}
          </span>
        </ScreenHeader>

        <section className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <Inbox size={24} />
          </span>

          <SectionLabel className="mt-6">Workspace</SectionLabel>

          <h1 className="mt-3 text-2xl font-bold tracking-tight">
            You're all set
          </h1>

          <p className="mt-3 max-w-xs text-sm leading-7 text-slate-500">
            Your profile is saved locally and survives closing the panel.
            Inbox, Contacts and Communities land in the next milestone.
          </p>
        </section>

        <footer className="border-t border-slate-200 p-6">
          <Button
            variant="outline"
            fullWidth
            leftIcon={<LogOut size={16} />}
            onClick={signOut}
          >
            Sign out
          </Button>
        </footer>
      </div>
    </AppShell>
  );
}
