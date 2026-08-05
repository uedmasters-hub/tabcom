/**
 * Registered-only gate for advanced privacy features.
 */
import { router } from "expo-router";
import { alert } from "@/lib/alert";
import { useAuth } from "@/stores/auth";

export function isRegisteredForPrivacy(): boolean {
  const { sessionToken, guest } = useAuth.getState();
  return !!sessionToken && !guest;
}

/**
 * Returns true if the user may use privacy features.
 * Otherwise prompts them to register and returns false.
 */
export function requireRegisteredPrivacy(featureLabel = "Privacy controls"): boolean {
  if (isRegisteredForPrivacy()) return true;

  alert(
    "Register to unlock privacy",
    `${featureLabel} are available on registered Tabcom accounts. Guests use standard messaging.`,
    [
      {
        text: "Register",
        onPress: () => {
          try {
            router.push("/(auth)/register" as any);
          } catch {
            router.push("/(auth)/welcome" as any);
          }
        },
      },
      { text: "Not now", style: "cancel" },
    ]
  );
  return false;
}
