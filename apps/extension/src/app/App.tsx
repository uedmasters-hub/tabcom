import WelcomeScreen from "../features/welcome";
import SignInScreen from "../features/signin";

import { useAppStore } from "../stores/app.store";

export default function App() {
  const screen = useAppStore((state) => state.screen);

  switch (screen) {
    case "signin":
      return <SignInScreen />;

    case "welcome":
    default:
      return <WelcomeScreen />;
  }
}