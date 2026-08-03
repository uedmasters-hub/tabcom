import { useEffect } from "react";
import {
  Text,
  View,
  Pressable,
  ScrollView,
  Switch,
  Modal,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui";
import { proximityLabel } from "@/lib/nearby";
import { useNearbyStore } from "@/stores/nearby";
import { useAuth } from "@/stores/auth";
import { alert } from "@/lib/alert";

function statusTone(status: string): { bg: string; text: string; icon: keyof typeof Ionicons.glyphMap } {
  switch (status) {
    case "peers_found":
    case "connected":
      return { bg: "bg-emerald-50", text: "text-emerald-800", icon: "checkmark-circle" };
    case "searching":
    case "advertising":
    case "connecting":
      return { bg: "bg-blue-50", text: "text-blue-800", icon: "radio-outline" };
    case "permissions_required":
    case "bluetooth_disabled":
    case "wifi_disabled":
    case "battery_saver":
    case "unsupported":
    case "connection_failed":
    case "incompatible_version":
      return { bg: "bg-amber-50", text: "text-amber-900", icon: "warning-outline" };
    default:
      return { bg: "bg-slate-50", text: "text-slate-600", icon: "ellipse-outline" };
  }
}

function statusTitle(status: string): string {
  switch (status) {
    case "idle":
      return "Off";
    case "permissions_required":
      return "Permissions Required";
    case "bluetooth_disabled":
      return "Bluetooth Disabled";
    case "wifi_disabled":
      return "Wi‑Fi Disabled";
    case "unsupported":
      return "Unsupported Build";
    case "battery_saver":
      return "Paused — Battery Saver";
    case "searching":
    case "advertising":
      return "Searching";
    case "peers_found":
      return "Nearby Devices Found";
    case "connecting":
      return "Connecting";
    case "connected":
      return "Connected";
    case "connection_failed":
      return "Connection Failed";
    case "incompatible_version":
      return "Incompatible Version";
    default:
      return status;
  }
}

export default function DiscoverNearbyScreen() {
  const router = useRouter();
  const { sessionToken, guest } = useAuth();
  const isRegistered = !!sessionToken && !guest;

  const enabled = useNearbyStore((s) => s.enabled);
  const status = useNearbyStore((s) => s.status);
  const statusDetail = useNearbyStore((s) => s.statusDetail);
  const recovery = useNearbyStore((s) => s.recovery);
  const peers = useNearbyStore((s) => s.peers);
  const incoming = useNearbyStore((s) => s.incoming);
  const hydrate = useNearbyStore((s) => s.hydrate);
  const enable = useNearbyStore((s) => s.enable);
  const disable = useNearbyStore((s) => s.disable);
  const connect = useNearbyStore((s) => s.connect);
  const acceptIncoming = useNearbyStore((s) => s.acceptIncoming);
  const declineIncoming = useNearbyStore((s) => s.declineIncoming);
  const ignoreIncoming = useNearbyStore((s) => s.ignoreIncoming);
  const retry = useNearbyStore((s) => s.retry);
  const openInstall = useNearbyStore((s) => s.openInstall);
  const openSettings = useNearbyStore((s) => s.openSettings);

  useEffect(() => hydrate(), [hydrate]);

  const onToggle = async (next: boolean) => {
    if (!isRegistered) {
      alert(
        "Invite required",
        "Discover Nearby is available for registered accounts. Sign in with an invite to enable it."
      );
      return;
    }
    if (next) {
      const result = await enable();
      if (!result.ok) {
        alert("Can't enable Nearby", "Sign in with a registered account first.");
      }
    } else {
      await disable();
    }
  };

  const onRecovery = () => {
    if (recovery.kind === "open_settings") openSettings();
    else if (recovery.kind === "retry") void retry();
    else if (recovery.kind === "install") openInstall();
    else if (recovery.kind === "disable") void disable();
  };

  const tone = statusTone(status);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white">
      <View className="flex-row items-center px-5 pt-2 pb-4">
        <Pressable
          onPress={() => router.back()}
          className="flex-row items-center gap-1 active:opacity-60"
        >
          <Ionicons name="chevron-back" size={22} color="#0f172a" />
          <Text className="text-ink text-[16px] font-medium">Back</Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
      >
        <Text className="text-ink text-[28px] font-extrabold tracking-tight">
          Discover Nearby
        </Text>
        <Text className="text-slate-500 text-[14px] leading-5 mt-2">
          Temporarily find people next to you over Bluetooth and Wi‑Fi. Nearby
          Discovery is secure, short-lived, and only active while you leave it
          on — nothing personally identifiable is broadcast.
        </Text>

        <View className="mt-6 flex-row items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
          <View className="flex-1 pr-3">
            <Text className="text-ink text-[15px] font-semibold">
              Enable Nearby Discovery
            </Text>
            <Text className="text-slate-400 text-[12px] mt-1 leading-4">
              {isRegistered
                ? "Off by default. Advertising and scanning start only when you turn this on."
                : "Registered accounts only — guests can't advertise or scan."}
            </Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={(v) => void onToggle(v)}
            disabled={!isRegistered && !enabled}
            trackColor={{ false: "#e2e8f0", true: "#93c5fd" }}
            thumbColor={enabled ? "#2563eb" : "#f8fafc"}
          />
        </View>

        {enabled && (
          <View className={`mt-4 rounded-2xl px-4 py-3 flex-row items-start gap-3 ${tone.bg}`}>
            {status === "searching" || status === "advertising" || status === "connecting" ? (
              <ActivityIndicator size="small" color="#1e40af" />
            ) : (
              <Ionicons name={tone.icon} size={18} color="#92400e" style={{ marginTop: 2 }} />
            )}
            <View className="flex-1">
              <Text className={`text-[13px] font-semibold ${tone.text}`}>
                {statusTitle(status)}
              </Text>
              {statusDetail ? (
                <Text className={`text-[12px] mt-1 leading-4 ${tone.text} opacity-90`}>
                  {statusDetail}
                </Text>
              ) : null}
              {recovery.kind !== "none" && recovery.label ? (
                <Pressable onPress={onRecovery} className="mt-2 self-start active:opacity-70">
                  <Text className={`text-[13px] font-bold ${tone.text}`}>
                    {recovery.label}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}

        {enabled && (
          <View className="mt-8">
            <Text className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Nearby devices
            </Text>

            {peers.length === 0 ? (
              <View className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 items-center">
                <Ionicons name="bluetooth-outline" size={28} color="#94a3b8" />
                <Text className="text-slate-500 text-[14px] mt-3 text-center">
                  No Tabcom devices nearby yet
                </Text>
                <Text className="text-slate-400 text-[12px] mt-1 text-center leading-4">
                  Ask a friend to enable Discover Nearby on their phone.
                </Text>
              </View>
            ) : (
              peers.map((peer) => (
                <View
                  key={peer.peerId}
                  className="flex-row items-center py-3.5 border-b border-slate-100"
                >
                  <Avatar
                    name={peer.displayName ?? "?"}
                    color={peer.avatarColor ?? "#94a3b8"}
                    size="md"
                  />
                  <View className="flex-1 ml-3">
                    <Text className="text-ink text-[15px] font-semibold">
                      {peer.handshaken && peer.displayName
                        ? peer.displayName
                        : "Tabcom device"}
                    </Text>
                    <Text className="text-slate-400 text-[12px] mt-0.5">
                      {proximityLabel(peer.proximity)}
                      {peer.handshaken && peer.presence
                        ? ` · ${peer.presence}`
                        : peer.compatible
                          ? " · Waiting to connect"
                          : " · Incompatible version"}
                    </Text>
                  </View>
                  {peer.compatible ? (
                    <Pressable
                      onPress={() => void connect(peer.peerId)}
                      disabled={peer.connected || status === "connecting"}
                      className="bg-primary rounded-xl px-3.5 py-2 active:opacity-80 disabled:opacity-40"
                    >
                      <Text className="text-white text-[13px] font-bold">
                        {peer.connected ? "Linked" : "Connect"}
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={openInstall}
                      className="bg-slate-900 rounded-xl px-3.5 py-2 active:opacity-80"
                    >
                      <Text className="text-white text-[12px] font-bold">Install</Text>
                    </Pressable>
                  )}
                </View>
              ))
            )}
          </View>
        )}

        <View className="mt-10 rounded-2xl border border-slate-100 px-4 py-4">
          <Text className="text-ink text-[14px] font-semibold">
            Friend doesn't have Tabcom?
          </Text>
          <Text className="text-slate-400 text-[12px] mt-1 leading-4">
            Share the current test build. This link is configurable and will
            later point at the App Store, Play Store, or invite page.
          </Text>
          <View className="mt-3">
            <Button variant="secondary" onPress={openInstall}>
              Install Tabcom
            </Button>
          </View>
        </View>
      </ScrollView>

      <Modal visible={!!incoming} transparent animationType="fade">
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-white rounded-t-3xl px-5 pt-5 pb-10">
            <Text className="text-ink text-[20px] font-bold">Nearby connect request</Text>
            <Text className="text-slate-500 text-[14px] mt-2 leading-5">
              A nearby Tabcom device wants to connect. No profile details are
              shared until you accept.
            </Text>
            <Text className="text-slate-400 text-[12px] mt-3">
              {incoming?.label ?? "Nearby device"}
            </Text>
            <View className="mt-6 gap-2">
              <Button onPress={() => void acceptIncoming()}>Accept</Button>
              <Button variant="secondary" onPress={() => void declineIncoming()}>
                Decline
              </Button>
              <Pressable
                onPress={() => void ignoreIncoming()}
                className="py-3 items-center active:opacity-60"
              >
                <Text className="text-slate-400 text-[14px] font-medium">Ignore</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
