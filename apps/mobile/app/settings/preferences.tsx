import { useState } from "react";
import { Text, View, Pressable, Switch, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/stores/auth";
import { syncSettingsToServer } from "@/lib/settings-sync";

interface ToggleRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description: string;
  value: boolean;
  onToggle: (v: boolean) => void;
}

function ToggleRow({ icon, label, description, value, onToggle }: ToggleRowProps) {
  return (
    <View className="flex-row items-center px-5 py-4 border-b border-slate-50">
      <View className="w-10">
        <Ionicons name={icon} size={20} color="#64748b" />
      </View>
      <View className="flex-1 mr-4">
        <Text className="text-ink text-[15px] font-semibold">{label}</Text>
        <Text className="text-muted text-[13px] mt-0.5">{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: "#e2e8f0", true: "#0f172a" }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

export default function PreferencesScreen() {
  const router = useRouter();
  const { sessionToken } = useAuth();

  const [cursors, setCursors] = useState(true);
  const [animations, setAnimations] = useState(true);
  const [floatingChat, setFloatingChat] = useState(true);

  const sync = (patch: Record<string, boolean>) => {
    syncSettingsToServer(sessionToken, patch);
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-row items-center px-5 pt-3 pb-4">
        <Pressable
          onPress={() => router.back()}
          className="flex-row items-center gap-1 active:opacity-60"
        >
          <Ionicons name="chevron-back" size={20} color="#0f172a" />
          <Text className="text-ink text-[16px] font-medium">Back</Text>
        </Pressable>
      </View>

      <Text className="text-ink text-[30px] font-extrabold tracking-tight px-6 mb-6">
        Preferences
      </Text>

      <ScrollView className="flex-1">
        <ToggleRow
          icon="navigate-outline"
          label="Live cursors"
          description="See where members are looking"
          value={cursors}
          onToggle={(v) => { setCursors(v); sync({ cursorsEnabled: v }); }}
        />
        <ToggleRow
          icon="sparkles-outline"
          label="Message animations"
          description="Spring animation on new message"
          value={animations}
          onToggle={(v) => { setAnimations(v); sync({ animations: v }); }}
        />
        <ToggleRow
          icon="browsers-outline"
          label="Floating chat"
          description="Pop out a chat into its own window"
          value={floatingChat}
          onToggle={(v) => { setFloatingChat(v); sync({ pipEnabled: v }); }}
        />

        <Text className="text-slate-400 text-[13px] text-center mt-8 px-8 leading-5">
          These preferences sync with the browser extension automatically.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
