import { Tabs } from "expo-router";
import { Text } from "react-native";

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.45 }}>{glyph}</Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: "#0B0B0F" },
        headerTintColor: "#FFFFFF",
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: "#15151C",
          borderTopColor: "#2A2A36",
        },
        tabBarActiveTintColor: "#7C6CF6",
        tabBarInactiveTintColor: "#6B6B7A",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Chats",
          tabBarIcon: ({ focused }) => <TabIcon glyph="💬" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="communities"
        options={{
          title: "Communities",
          tabBarIcon: ({ focused }) => <TabIcon glyph="🏘️" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: "Inbox",
          tabBarIcon: ({ focused }) => <TabIcon glyph="📥" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: "Contacts",
          tabBarIcon: ({ focused }) => <TabIcon glyph="👥" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ focused }) => <TabIcon glyph="⚙️" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
