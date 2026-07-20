import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "@/stores/auth";
import { useRealtime } from "@/stores/realtime";
import "../global.css";

export default function RootLayout() {
  const { hydrated, sessionToken, hydrate } = useAuth();
  const { connect, disconnect } = useRealtime();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => { void hydrate(); }, []);

  // Notification taps deep-link into the right screen.
  useEffect(() => {
    let unsub = () => {};
    import("@/lib/notifications").then(({ onNotificationTap }) => {
      unsub = onNotificationTap((data) => {
        if (data.type === "community" && data.communityId) {
          router.push(`/community/${data.communityId}` as any);
        } else if (data.type === "dm" || data.type === "connect_request" || data.type === "call") {
          router.push("/(tabs)" as any);
        }
      });
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (sessionToken) connect();
    else disconnect();
  }, [hydrated, sessionToken]);

  useEffect(() => {
    if (!hydrated) return;
    const inAuthGroup = segments[0] === ("(auth)" as any);
    if (!sessionToken && !inAuthGroup) router.replace("/(auth)/welcome" as any);
    else if (sessionToken && inAuthGroup) router.replace("/(tabs)" as any);
  }, [hydrated, sessionToken, segments]);

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
