import WelcomeScreen from "../features/welcome";
import SignInScreen from "../features/signin";

import { useAppStore } from "../stores/app.store";

import { VisibilityScreen } from "../features/onboarding";

export default function App() {
  const screen = useAppStore((state) => state.screen);

  switch (screen) {
    case "signin":
      return <SignInScreen />;

    case "welcome":
    default:
      return <WelcomeScreen />;

    case "visibility":
      return <VisibilityScreen />;
  }
}