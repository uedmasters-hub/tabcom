import { useEffect, useState } from "react";
import {
  Text, View, Pressable, ScrollView, Share,
  ActivityIndicator, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/stores/auth";
import { auth } from "@/lib/auth-client";

interface InviteSummary { code: string; used: boolean; usedAt: string | null; }

export default function InviteCodesScreen() {
  const router = useRouter();
  const { sessionToken } = useAuth();
  const [invites, setInvites] = useState<InviteSummary[] | null>(null);

  useEffect(() => {
    if (!sessionToken) return;
    auth.fetchInvites(sessionToken).then((r) => { if (r.ok) setInvites(r.invites); });
  }, [sessionToken]);

  const available = invites?.filter((i) => !i.used).length ?? 0;

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

      <Text className="text-ink text-[28px] font-extrabold tracking-tight px-6">
        Invite Codes
      </Text>
      <Text className="text-muted text-[15px] leading-[22px] px-6 mt-1 mb-6">
        {available} code{available !== 1 ? "s" : ""} available
      </Text>

      <ScrollView className="flex-1 px-6">
        {!invites ? (
          <ActivityIndicator color="#2563eb" className="mt-8" />
        ) : invites.length === 0 ? (
          <Text className="text-muted text-center mt-8">No invite codes yet.</Text>
        ) : (
          invites.map((inv) => (
            <View
              key={inv.code}
              className="flex-row items-center bg-surface rounded-xl px-5 py-4 mb-2.5"
            >
              <Text
                className={`flex-1 text-[15px] ${inv.used ? "text-slate-400" : "text-ink font-semibold"}`}
                style={{ fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}
              >
                {inv.code}
              </Text>
              {inv.used ? (
                <Text className="text-slate-400 text-[13px] font-medium">Used</Text>
              ) : (
                <Pressable
                  onPress={() =>
                    Share.share({ message: "Join me on Tabcom! Use this invite code: " + inv.code })
                  }
                  className="bg-ink rounded-lg px-4 py-2 active:opacity-85"
                >
                  <Text className="text-white text-[13px] font-bold">Share</Text>
                </Pressable>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
