import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "@/stores/auth";
import { useOnboarding } from "@/lib/onboarding";
import { useChatStore } from "@/stores/chat";
import { useRealtime } from "@/stores/realtime";
import "../global.css";

export default function RootLayout() {
  const { hydrated, sessionToken, guest, hydrate } = useAuth();
  // Guests are signed in without a server token.
  const signedIn = !!sessionToken || !!guest;
  const { connect, disconnect } = useRealtime();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => { void hydrate(); }, []);

  // Preload the same demo roster the extension ships with, so a new
  // user has something to look at. Removable per-contact.
  useEffect(() => {
    if (hydrated && signedIn) useChatStore.getState().ensureSeeded();
  }, [hydrated, signedIn]);

  // Channels must exist before the first notification arrives, or
  // Android silently drops it into a default bucket.
  useEffect(() => {
    void import("@/lib/notifications").then(({ configureNotifications }) =>
      configureNotifications()
    );
  }, []);

  // Notification taps deep-link straight to the relevant screen. The
  // server puts the destination in `route`, so routing stays server-
  // driven rather than duplicated per notification type here.
  useEffect(() => {
    let unsub = () => {};
    void import("@/lib/notifications").then(({ attachNotificationRouting }) => {
      unsub = attachNotificationRouting((route, data) => {
        if (data?.type === "call" && data?.from) {
          const name = encodeURIComponent(String(data.name ?? data.from));
          const color = encodeURIComponent(String(data.color ?? "#2563eb"));
          router.push(
            `/call/${data.from}?peerName=${name}&peerColor=${color}&role=callee&video=${!!data.video}` as any
          );
          return;
        }
        router.push(route as any);
      });
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (signedIn) connect();
    else disconnect();
  }, [hydrated, signedIn]);

  // Onboarding is shown once, before the welcome screen, and only to
  // signed-out users. Subscribed from the store rather than read into
  // local state, so completing onboarding updates this gate straight
  // away instead of leaving it holding a stale `false`.
  const seenOnboarding = useOnboarding((s) => s.seen);
  const hydrateOnboarding = useOnboarding((s) => s.hydrate);
  useEffect(() => {
    void hydrateOnboarding();
  }, [hydrateOnboarding]);

  useEffect(() => {
    if (!hydrated || seenOnboarding === null) return;
    const inAuthGroup = segments[0] === ("(auth)" as any);
    const onOnboarding = (segments as string[])[1] === "onboarding";
    if (signedIn && inAuthGroup) {
      router.replace("/(tabs)" as any);
    } else if (!signedIn && !seenOnboarding && !onOnboarding) {
      router.replace("/(auth)/onboarding" as any);
    } else if (!signedIn && seenOnboarding && !inAuthGroup) {
      router.replace("/(auth)/welcome" as any);
    }
  }, [hydrated, signedIn, segments, seenOnboarding]);

  if (!hydrated || seenOnboarding === null) {
    return (
      <View style={{ flex: 1, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#2563eb" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#ffffff" } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
      </Stack>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
