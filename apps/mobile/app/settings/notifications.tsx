import { useState } from "react";
import { Text, View, Pressable, ScrollView, Switch } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/stores/auth";

function SectionTitle({ children }: { children: string }) {
  return (
    <Text className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider px-5 pt-5 pb-2">
      {children}
    </Text>
  );
}

function ToggleRow({ icon, label, sub, value, onToggle, locked }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; sub: string;
  value: boolean; onToggle: (v: boolean) => void; locked?: boolean;
}) {
  return (
    <View className={`flex-row items-center px-5 py-[14px] ${locked ? "opacity-40" : ""}`}>
      <View className="w-9 items-center">
        <Ionicons name={icon} size={19} color="#64748b" />
      </View>
      <View className="flex-1 ml-1 mr-4">
        <Text className="text-ink text-[15px] font-medium">{label}</Text>
        <Text className="text-[12px] text-slate-400 mt-0.5">{sub}</Text>
      </View>
      {locked ? (
        <Ionicons name="lock-closed" size={14} color="#cbd5e1" />
      ) : (
        <Switch value={value} onValueChange={onToggle}
          trackColor={{ false: "#e2e8f0", true: "#0f172a" }} thumbColor="#fff" />
      )}
    </View>
  );
}

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const { guest } = useAuth();
  const isGuest = !!guest;

  const [global, setGlobal] = useState(true);
  const [dnd, setDnd] = useState(false);
  const [dms, setDms] = useState(true);
  const [groups, setGroups] = useState(true);
  const [communities, setCommunities] = useState(true);
  const [connections, setConnections] = useState(true);
  const [sound, setSound] = useState(true);
  const [vibration, setVibration] = useState(true);
  const [badge, setBadge] = useState(true);

  return (
    <SafeAreaView className="flex-1 bg-background">
      <Pressable onPress={() => router.back()}
        className="flex-row items-center gap-1 self-start px-5 pt-3 pb-1 active:opacity-60">
        <Ionicons name="chevron-back" size={20} color="#0f172a" />
        <Text className="text-ink text-[16px] font-medium">Back</Text>
      </Pressable>

      <View className="px-6 pt-3 pb-1">
        <Text className="text-ink text-[28px] font-extrabold tracking-tight">Notifications</Text>
        <Text className="text-muted text-[14px] mt-1">Control how you get notified.</Text>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <SectionTitle>General</SectionTitle>
        <ToggleRow icon="notifications-outline" label="Notifications"
          sub="Enable or disable all notifications"
          value={global} onToggle={setGlobal} />
        <ToggleRow icon="moon-outline" label="Do Not Disturb"
          sub="Silence all notifications temporarily"
          value={dnd} onToggle={setDnd} locked={isGuest} />

        <SectionTitle>Channels</SectionTitle>
        <ToggleRow icon="chatbubble-outline" label="Direct messages"
          sub="Notifications for one-on-one chats"
          value={dms} onToggle={setDms} />
        <ToggleRow icon="people-outline" label="Group messages"
          sub="Notifications for group conversations"
          value={groups} onToggle={setGroups} />
        <ToggleRow icon="globe-outline" label="Communities"
          sub="Activity in your communities"
          value={communities} onToggle={setCommunities} locked={isGuest} />
        <ToggleRow icon="person-add-outline" label="Connection requests"
          sub="When someone wants to connect"
          value={connections} onToggle={setConnections} locked={isGuest} />

        <SectionTitle>Alerts</SectionTitle>
        <ToggleRow icon="volume-high-outline" label="Sound"
          sub="Play a sound for notifications"
          value={sound} onToggle={setSound} />
        <ToggleRow icon="phone-portrait-outline" label="Vibration"
          sub="Vibrate on notifications"
          value={vibration} onToggle={setVibration} />
        <ToggleRow icon="apps-outline" label="Badge count"
          sub="Show unread count on app icon"
          value={badge} onToggle={setBadge} />

        <Text className="text-slate-300 text-[12px] text-center mt-6 px-8 mb-8">
          Notification preferences sync across your devices.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
