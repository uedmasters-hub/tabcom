import WelcomeScreen from "../features/welcome";
import SignInScreen from "../features/signin";

import {
  VisibilityScreen,
  IdentityScreen,
  AvatarScreen,
} from "../features/onboarding";

import { useAppStore } from "../stores/app.store";

export default function App() {
  const screen = useAppStore((state) => state.screen);

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

    default:
      return <WelcomeScreen />;
  }
}