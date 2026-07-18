import { Tabs } from "expo-router";
import { Text } from "react-native";

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.4 }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: "#ffffff" },
        headerTintColor: "#0f172a",
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopColor: "#e2e8f0",
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: "#0f172a",
        tabBarInactiveTintColor: "#94a3b8",
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Inbox", tabBarIcon: ({ focused }) => <TabIcon glyph="📥" focused={focused} /> }} />
      <Tabs.Screen name="contacts" options={{ title: "Contacts", tabBarIcon: ({ focused }) => <TabIcon glyph="👥" focused={focused} /> }} />
      <Tabs.Screen name="communities" options={{ title: "Communities", tabBarIcon: ({ focused }) => <TabIcon glyph="🌐" focused={focused} /> }} />
      <Tabs.Screen name="inbox" options={{ title: "Chats", tabBarIcon: ({ focused }) => <TabIcon glyph="💬" focused={focused} /> }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: ({ focused }) => <TabIcon glyph="⚙️" focused={focused} /> }} />
    </Tabs>
  );
}
