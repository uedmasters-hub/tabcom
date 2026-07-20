import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { usePendingCount } from "@/hooks/useConnections";
import { useChatStore } from "@/stores/chat";

/** 4-tab shell per design: Chat · Community · Contacts · Settings.
 *  Inbox is merged into Chat; notifications live behind the header bell. */
export default function TabsLayout() {
  const pending = usePendingCount();
  const unread = useChatStore((s) =>
    s.conversations.reduce((sum, c) => sum + (c.unread ?? 0), 0)
  );

  // Launcher badge = unread messages + pending requests.
  useEffect(() => {
    void import("@/lib/notifications").then(({ setBadgeCount }) =>
      setBadgeCount(unread + pending)
    );
  }, [unread, pending]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopColor: "#f1f5f9",
          borderTopWidth: 1,
          height: 86,
          paddingTop: 8,
        },
        tabBarActiveTintColor: "#2563eb",
        tabBarInactiveTintColor: "#94a3b8",
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600", marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Chat",
          tabBarBadge: pending > 0 ? pending : undefined,
          tabBarBadgeStyle: { backgroundColor: "#2563eb", fontSize: 11 },
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "chatbubbles" : "chatbubbles-outline"} size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="communities"
        options={{
          title: "Community",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "people" : "people-outline"} size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: "Contacts",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "call" : "call-outline"} size={25} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "settings" : "settings-outline"} size={25} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
