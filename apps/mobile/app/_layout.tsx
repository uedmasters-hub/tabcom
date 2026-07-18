import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
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
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#ffffff" } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
      </Stack>
    </>
  );
}
