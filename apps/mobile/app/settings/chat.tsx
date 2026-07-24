import { useState } from "react";
import {
  Text, View, Pressable, ScrollView, Switch, Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/stores/auth";
import { useChatStore } from "@/stores/chat";
import { clearMyHistory } from "@/lib/realtime";

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

function NavRow({ icon, label, sub, onPress, danger, locked }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; sub?: string;
  onPress?: () => void; danger?: boolean; locked?: boolean;
}) {
  return (
    <Pressable
      onPress={locked ? undefined : onPress}
      className={`flex-row items-center px-5 py-[14px] ${locked ? "opacity-40" : "active:bg-slate-50"}`}
    >
      <View className="w-9 items-center">
        <Ionicons name={icon} size={19} color={danger ? "#dc2626" : "#64748b"} />
      </View>
      <View className="flex-1 ml-1">
        <Text className={`text-[15px] font-medium ${danger ? "text-danger" : "text-ink"}`}>{label}</Text>
        {sub && <Text className="text-[12px] text-slate-400 mt-0.5">{sub}</Text>}
      </View>
      {locked ? (
        <View className="flex-row items-center gap-1">
          <Ionicons name="lock-closed" size={13} color="#cbd5e1" />
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
      )}
    </Pressable>
  );
}

export default function ChatSettingsScreen() {
  const router = useRouter();
  const { guest } = useAuth();
  const isGuest = !!guest;
  const [readReceipts, setReadReceipts] = useState(true);
  const [typing, setTyping] = useState(true);
  const [linkPreviews, setLinkPreviews] = useState(true);
  const [autoDownload, setAutoDownload] = useState(true);

  const handleClear = () => {
    Alert.alert("Clear chat history",
      "This removes all messages and conversations. Contacts and communities stay intact.",
      [{ text: "Cancel", style: "cancel" },
       { text: "Clear", style: "destructive", onPress: async () => {
         await clearMyHistory(); useChatStore.getState().resetChat();
       }}],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <Pressable onPress={() => router.back()}
        className="flex-row items-center gap-1 self-start px-5 pt-3 pb-1 active:opacity-60">
        <Ionicons name="chevron-back" size={20} color="#0f172a" />
        <Text className="text-ink text-[16px] font-medium">Back</Text>
      </Pressable>

      <View className="px-6 pt-3 pb-1">
        <Text className="text-ink text-[30px] font-extrabold tracking-tight">Chat</Text>
        <Text className="text-muted text-[14px] mt-1">Manage your chat experience.</Text>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <SectionTitle>Privacy</SectionTitle>
        <ToggleRow icon="eye-outline" label="Read receipts"
          sub="Let others see when you've read messages"
          value={readReceipts} onToggle={setReadReceipts} />
        <ToggleRow icon="ellipsis-horizontal-outline" label="Typing indicators"
          sub="Show when you're typing"
          value={typing} onToggle={setTyping} />
        <ToggleRow icon="link-outline" label="Link previews"
          sub="Generate previews for shared links"
          value={linkPreviews} onToggle={setLinkPreviews} />

        <SectionTitle>Media & Storage</SectionTitle>
        <ToggleRow icon="download-outline" label="Auto-download media"
          sub="Automatically download images and files"
          value={autoDownload} onToggle={setAutoDownload} />
        <NavRow icon="folder-outline" label="Storage usage"
          sub="View and manage downloaded media" onPress={() => {}} />

        <SectionTitle>People</SectionTitle>
        <NavRow icon="ban-outline" label="Blocked users"
          sub="Manage blocked contacts" onPress={() => {}} />

        <SectionTitle>Data</SectionTitle>
        <NavRow icon="cloud-upload-outline" label="Chat backup"
          sub="Back up your messages" locked={isGuest} />
        <NavRow icon="swap-horizontal-outline" label="Transfer chats"
          sub="Move chats to a new device" locked={isGuest} />
        <NavRow icon="trash-outline" label="Clear chat history"
          sub="Delete all messages" onPress={handleClear} danger />

        <View className="h-12" />
      </ScrollView>
    </SafeAreaView>
  );
}
