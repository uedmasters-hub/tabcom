import { useEffect } from "react";

import WelcomeScreen from "../features/welcome";
import SignInScreen from "../features/signin";
import WorkspaceScreen from "../features/workspace";

import {
  VisibilityScreen,
  IdentityScreen,
  AvatarScreen,
} from "../features/onboarding";

import { useAppStore } from "../stores/app.store";
import { useProfileStore } from "../stores/profile.store";

export default function App() {
  const screen = useAppStore((state) => state.screen);
  const setScreen = useAppStore((state) => state.setScreen);

  const hasHydrated = useProfileStore((state) => state.hasHydrated);
  const isComplete = useProfileStore((state) => state.isComplete);

  // Returning users skip onboarding once storage has hydrated.
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

    case "visibility":
      return <VisibilityScreen />;

    case "identity":
      return <IdentityScreen />;

    case "avatar":
      return <AvatarScreen />;

    case "workspace":
      return <WorkspaceScreen />;

    default:
      return <WelcomeScreen />;
  }
}
