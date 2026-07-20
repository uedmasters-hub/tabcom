import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "@/stores/auth";
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

  useEffect(() => {
    if (!hydrated) return;
    const inAuthGroup = segments[0] === ("(auth)" as any);
    if (!signedIn && !inAuthGroup) router.replace("/(auth)/welcome" as any);
    else if (signedIn && inAuthGroup) router.replace("/(tabs)" as any);
  }, [hydrated, signedIn, segments]);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#2563eb" />
      </View>
    );
  }

  return (
    <KeyboardProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#ffffff" } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
      </Stack>
    </KeyboardProvider>
  );
}
