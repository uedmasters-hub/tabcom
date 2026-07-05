import { useEffect } from "react";

import WelcomeScreen from "../features/welcome";
import SignInScreen from "../features/signin";
import WorkspaceScreen from "../features/workspace";

import { DoneScreen, ProfileScreen, RegisterScreen, SetupScreen } from "../features/onboarding";

import { useAppStore } from "../stores/app.store";
import { useProfileStore } from "../stores/profile.store";

export default function App() {
  const screen = useAppStore((state) => state.screen);
  const setScreen = useAppStore((state) => state.setScreen);

  const hasHydrated = useProfileStore((state) => state.hasHydrated);
  const isComplete = useProfileStore((state) => state.isComplete);

  // Returning users skip onboarding once storage has hydrated. The
  // socket's own session validation (server-side) is the real gate —
  // if a stored session has expired, connecting simply falls back to
  // the pre-auth trust model rather than hard-locking someone out of
  // an extension they already set up.
  useEffect(() => {
    if (hasHydrated && isComplete) {
      setScreen("workspace");
    }
  }, [hasHydrated, isComplete, setScreen]);

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

    case "workspace":
      return <WorkspaceScreen />;

    default:
      return <WelcomeScreen />;
  }
}
