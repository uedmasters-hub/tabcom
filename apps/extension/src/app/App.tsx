import { useEffect } from "react";

import WelcomeScreen from "../features/welcome";
import SignInScreen from "../features/signin";
import WorkspaceScreen from "../features/workspace";
import { GuestExpiredScreen, GuestSetupScreen } from "../features/guest";

import { DoneScreen, ProfileScreen, RegisterScreen, SetupScreen } from "../features/onboarding";

import { useAppStore } from "../stores/app.store";
import { useChatStore } from "../stores/chat.store";
import { useProfileStore } from "../stores/profile.store";
import { disconnectRealtime } from "../lib/realtime";

export default function App() {
  const screen = useAppStore((state) => state.screen);
  const setScreen = useAppStore((state) => state.setScreen);

  const hasHydrated = useProfileStore((state) => state.hasHydrated);
  const isComplete = useProfileStore((state) => state.isComplete);
  const isGuestSessionExpired = useProfileStore(
    (state) => state.isGuestSessionExpired
  );
  const endGuestSession = useProfileStore((state) => state.endGuestSession);
  const resetChat = useChatStore((state) => state.resetChat);

  // Returning users skip onboarding once storage has hydrated. The
  // socket's own session validation (server-side) is the real gate —
  // if a stored session has expired, connecting simply falls back to
  // the pre-auth trust model rather than hard-locking someone out of
  // an extension they already set up.
  //
  // Guest sessions are the one exception: a guest whose 30 minutes
  // ran out while the popup was closed should land on the "session
  // ended" screen on reopen, not silently back in the workspace — and
  // with a fully clean chat.store, not carrying anything forward. A
  // guest identity is disposable by design; nothing about it should
  // outlive the session it belonged to.
  useEffect(() => {
    if (!hasHydrated || !isComplete) return;

    if (isGuestSessionExpired()) {
      endGuestSession();
      resetChat();
      disconnectRealtime();
      setScreen("guest-expired");
      return;
    }

    setScreen("workspace");
  }, [hasHydrated, isComplete, isGuestSessionExpired, endGuestSession, resetChat, setScreen]);

  // Avoid a welcome-screen flash while browser.storage loads.
  if (!hasHydrated) {
    return null;
  }

  switch (screen) {
    case "welcome":
      return <WelcomeScreen />;

    case "signin":
      return <SignInScreen />;

    case "register":
      return <RegisterScreen />;

    case "profile":
      return <ProfileScreen />;

    case "done":
      return <DoneScreen />;

    case "setup":
      return <SetupScreen />;

    case "guest-setup":
      return <GuestSetupScreen />;

    case "guest-expired":
      return <GuestExpiredScreen />;

    case "workspace":
      return <WorkspaceScreen />;

    default:
      return <WelcomeScreen />;
  }
}
