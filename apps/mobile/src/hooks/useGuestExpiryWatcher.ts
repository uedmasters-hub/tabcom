/**
 * Watches the live guest clock. When the 30-minute window ends,
 * fully wipes guest data and routes to the expired screen.
 */
import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/stores/auth";
import { isGuestExpired } from "@/lib/guest-session";

export function useGuestExpiryWatcher() {
  const guest = useAuth((s) => s.guest);
  const endGuestSession = useAuth((s) => s.endGuestSession);
  const router = useRouter();
  const endingRef = useRef(false);

  useEffect(() => {
    if (!guest) {
      endingRef.current = false;
      return;
    }

    const expire = async () => {
      if (endingRef.current) return;
      if (!isGuestExpired(guest.startedAt)) return;
      endingRef.current = true;
      try {
        await endGuestSession();
        router.replace("/(auth)/guest-expired" as any);
      } catch {
        endingRef.current = false;
      }
    };

    void expire();
    const interval = setInterval(() => {
      void expire();
    }, 1000);

    const onAppState = (next: AppStateStatus) => {
      if (next === "active") void expire();
    };
    const sub = AppState.addEventListener("change", onAppState);

    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [guest?.startedAt, guest?.username, endGuestSession, router]);
}
