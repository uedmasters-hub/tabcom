import { useCallback, useEffect, useRef, useState } from "react";
import {
  Text, View, Pressable, TextInput, ScrollView,
  KeyboardAvoidingView, Platform, Alert, Keyboard,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui";
import { useAuth } from "@/stores/auth";
import { usePresence } from "@/stores/presence";
import { auth } from "@/lib/auth-client";
import { reannounce } from "@/lib/realtime";
import { syncSettingsToServer } from "@/lib/settings-sync";
import type { WirePresence } from "@tabcom/shared";

const AVATAR_COLORS = [
  "#2563eb", "#7c3aed", "#a855f7", "#ec4899",
  "#f97316", "#16a34a", "#475569",
];

const PRESENCE_OPTIONS: Array<{ value: WirePresence; label: string; dot: string }> = [
  { value: "online",  label: "Online",  dot: "#16a34a" },
  { value: "away",    label: "Away",    dot: "#d97706" },
  { value: "busy",    label: "Busy",    dot: "#dc2626" },
  { value: "offline", label: "Hidden",  dot: "#94a3b8" },
];

function InfoRow({ icon, label, value, sub, trailing, editable, onPress }: {
  icon: keyof typeof Ionicons.glyphMap;
  label?: string; value: string; sub?: string;
  trailing?: React.ReactNode; editable?: boolean; onPress?: () => void;
}) {
  const Wrapper = editable ? Pressable : View;
  return (
    <Wrapper onPress={onPress} className={`flex-row items-center py-4 border-b border-slate-100 ${editable ? "active:bg-slate-50" : ""}`}>
      <View className="w-10">
        <Ionicons name={icon} size={20} color="#94a3b8" />
      </View>
      <View className="flex-1">
        {label && <Text className="text-[11px] text-slate-400 uppercase tracking-wider mb-0.5">{label}</Text>}
        <Text className="text-ink text-[15px]">{value}</Text>
        {sub && (
          <View className="flex-row items-center gap-1 mt-1">
            <Ionicons name="information-circle" size={13} color="#d97706" />
            <Text className="text-warning text-[12px]">{sub}</Text>
          </View>
        )}
      </View>
      {trailing}
      {editable && !trailing && <Ionicons name="chevron-forward" size={16} color="#d1d5db" />}
    </Wrapper>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { user, sessionToken, guest } = useAuth();
  const presence = usePresence((s) => s.presence);
  const changePresence = usePresence((s) => s.changePresence);

  const isGuest = !!guest;
  const isRegistered = !!sessionToken;

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.displayName ?? "");
  const [color, setColor] = useState(user?.avatarColor ?? "#2563eb");
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<TextInput>(null);

  useEffect(() => {
    if (editing) {
      const t = setTimeout(() => nameRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [editing]);

  const startEdit = () => { setName(user?.displayName ?? ""); setEditing(true); };
  const cancelEdit = () => { Keyboard.dismiss(); setEditing(false); };

  const saveName = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    setSaving(true);
    const u = useAuth.getState().user;
    if (u) {
      u.displayName = trimmed;
      useAuth.setState({ user: { ...u } });
      reannounce({ username: u.username ?? "", name: trimmed, color, visibility: "public" });
    }
    Keyboard.dismiss();
    setEditing(false);
    setSaving(false);
  }, [name, color]);

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      Alert.alert("Photo selected", "Photo upload will be available soon.");
    }
  };

  const selectColor = (c: string) => {
    setColor(c); setShowColorPicker(false);
    const u = useAuth.getState().user;
    if (u) {
      u.avatarColor = c;
      useAuth.setState({ user: { ...u } });
      reannounce({ username: u.username ?? "", name: u.displayName ?? "", color: c, visibility: "public" });
    }
    syncSettingsToServer(sessionToken, {});
  };

  const heroColor = color || "#2563eb";

  /* ── Header ── */
  const headerContent = (
    <View className="flex-row items-center justify-between px-5 pt-2 pb-4">
      <Pressable
        onPress={editing ? cancelEdit : () => router.back()}
        className="flex-row items-center gap-1 active:opacity-60"
      >
        <Ionicons name="chevron-back" size={22} color="#fff" />
        <Text className="text-white text-[16px] font-medium">Back</Text>
      </Pressable>
      <Pressable
        onPress={() => setShowColorPicker(!showColorPicker)}
        className="w-10 h-10 rounded-full border-[1.5px] border-white/25 items-center justify-center active:opacity-70"
      >
        <Ionicons name="color-palette-outline" size={18} color="rgba(255,255,255,0.8)" />
      </Pressable>
    </View>
  );

  /* ── Color picker ── */
  const colorPicker = showColorPicker ? (
    <View className="absolute top-2 right-5 bg-white rounded-2xl p-2.5 z-20"
      style={{ elevation: 10, shadowColor: "#000", shadowOpacity: 0.12,
        shadowRadius: 16, shadowOffset: { width: 0, height: 6 } }}>
      {AVATAR_COLORS.map((c) => (
        <Pressable key={c} onPress={() => selectColor(c)} className="mb-1 active:opacity-70">
          <View style={{ backgroundColor: c, borderWidth: c === color ? 2.5 : 0, borderColor: "#0f172a" }}
            className="w-9 h-9 rounded-full" />
        </Pressable>
      ))}
    </View>
  ) : null;

  /* ── Avatar ── */
  const avatarBlock = (
    <Pressable onPress={pickPhoto} className="active:opacity-80">
      <View className="rounded-full p-[3px]" style={{ backgroundColor: "rgba(255,255,255,0.18)" }}>
        <Avatar name={user?.displayName ?? "?"} color={heroColor} size="xl" />
      </View>
      <View className="absolute bottom-0.5 right-0.5 w-7 h-7 rounded-full bg-white items-center justify-center"
        style={{ elevation: 4, shadowColor: "#000", shadowOpacity: 0.1,
          shadowRadius: 4, shadowOffset: { width: 0, height: 2 } }}>
        <Ionicons name="camera" size={14} color="#0f172a" />
      </View>
    </Pressable>
  );

  /* ═══════ EDIT MODE ═══════ */
  if (editing) {
    return (
      <View className="flex-1" style={{ backgroundColor: heroColor }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1"
        >
          <SafeAreaView edges={["top"]} className="w-full">
            {headerContent}
          </SafeAreaView>
          {colorPicker}

          <View className="flex-1 items-center justify-center px-8">
            {avatarBlock}
            <TextInput
              ref={nameRef}
              value={name}
              onChangeText={setName}
              onSubmitEditing={saveName}
              returnKeyType="done"
              className="text-white text-[28px] font-extrabold text-center mt-5 w-full"
              placeholderTextColor="rgba(255,255,255,0.35)"
              placeholder="Your Name"
              selectionColor="rgba(255,255,255,0.5)"
            />
            <Text className="text-white/50 text-[14px] mt-1">
              @{user?.username ?? "username"}
            </Text>
          </View>

          <SafeAreaView edges={["bottom"]} className="px-6 pb-2">
            <Button onPress={saveName} loading={saving}>Update</Button>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  /* ═══════ VIEW MODE ═══════ */
  return (
    <View className="flex-1 bg-background">
      <ScrollView className="flex-1" bounces={false} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={{ backgroundColor: heroColor }} className="pb-10 items-center">
          <SafeAreaView edges={["top"]} className="w-full">
            {headerContent}
          </SafeAreaView>
          {colorPicker}

          <View className="mt-4">{avatarBlock}</View>

          <Pressable onPress={startEdit} hitSlop={20} className="active:opacity-70 mt-4 px-8">
            <View className="flex-row items-center justify-center gap-2">
              <Text className="text-white text-[26px] font-extrabold text-center">
                {user?.displayName ?? "Your Name"}
              </Text>
              <Ionicons name="pencil" size={16} color="rgba(255,255,255,0.5)" />
            </View>
          </Pressable>
          <Text className="text-white/50 text-[14px] mt-1">
            @{user?.username ?? "username"}
          </Text>
          {isGuest && (
            <View className="bg-white/15 rounded-full px-3 py-1 mt-3">
              <Text className="text-white/80 text-[11px] font-semibold uppercase tracking-wider">
                Guest session
              </Text>
            </View>
          )}
        </View>

        {/* Presence */}
        <View className="px-5 pt-6 pb-2">
          <Text className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Status
          </Text>
          <View className="flex-row gap-2">
            {PRESENCE_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                onPress={() => changePresence(opt.value)}
                className={`flex-1 items-center py-3 rounded-xl border-[1.5px] ${
                  presence === opt.value ? "border-primary bg-primary/5" : "border-slate-100 bg-white"
                }`}
              >
                <View style={{ backgroundColor: opt.dot }}
                  className="w-2 h-2 rounded-full mb-1.5" />
                <Text className={`text-[12px] ${
                  presence === opt.value ? "text-ink font-bold" : "text-muted font-medium"
                }`}>{opt.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Personal Info ── */}
        <View className="px-5 pt-6 pb-2">
          <Text className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Personal info
          </Text>

          {/* Primary email (read-only) */}
          <InfoRow
            icon="mail-outline"
            label="Primary email"
            value={user?.email || "No email set"}
            sub={user?.email && !user?.verified ? "Your email isn't verified yet" : undefined}
            trailing={
              user?.email && !user?.verified ? (
                <Pressable
                  onPress={() => {
                    if (sessionToken) auth.sendVerificationEmail(sessionToken).then((r) => {
                      Alert.alert(r.ok ? "Sent" : "Error", r.ok ? "Check your inbox." : "Try again.");
                    });
                  }}
                  className="bg-success rounded-lg px-3.5 py-1.5 active:opacity-80"
                >
                  <Text className="text-white text-[12px] font-bold">Verify</Text>
                </Pressable>
              ) : user?.verified ? (
                <View className="flex-row items-center gap-1">
                  <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
                  <Text className="text-success text-[12px] font-medium">Verified</Text>
                </View>
              ) : undefined
            }
          />

          {/* Secondary email — registered only */}
          {isRegistered && (
            <InfoRow
              icon="mail-open-outline"
              value="Add secondary email"
              editable
              onPress={() => Alert.alert("Coming soon", "Secondary email support will be added soon.")}
              trailing={
                <View className="w-7 h-7 rounded-full bg-slate-100 items-center justify-center">
                  <Ionicons name="add" size={16} color="#64748b" />
                </View>
              }
            />
          )}

          {/* Phone */}
          <InfoRow
            icon="call-outline"
            label="Mobile"
            value={isRegistered ? "Add phone number" : "Not available for guests"}
            editable={isRegistered}
            onPress={isRegistered ? () => Alert.alert("Coming soon", "Phone number editing will be added soon.") : undefined}
          />

          {/* Address */}
          <InfoRow
            icon="location-outline"
            label="Address"
            value={isRegistered ? "Add home address" : "Not available for guests"}
            editable={isRegistered}
            onPress={isRegistered ? () => Alert.alert("Coming soon", "Address editing will be added soon.") : undefined}
          />
        </View>

        {/* ── Guest CTA ── */}
        {isGuest && (
          <View className="px-5 pt-6 pb-8">
            <Pressable
              onPress={() => router.push("/settings/request-invite" as any)}
              className="bg-primary/5 border border-primary/15 rounded-2xl p-5 active:opacity-80"
            >
              <View className="flex-row items-center gap-3">
                <View className="w-11 h-11 rounded-full bg-primary/10 items-center justify-center">
                  <Ionicons name="sparkles" size={22} color="#2563eb" />
                </View>
                <View className="flex-1">
                  <Text className="text-ink text-[15px] font-semibold">
                    Unlock all features
                  </Text>
                  <Text className="text-slate-400 text-[12px] mt-0.5 leading-4">
                    Request an invite to edit your phone, address, add secondary emails, and more.
                  </Text>
                </View>
              </View>
            </Pressable>
          </View>
        )}

        <View className="h-6" />
      </ScrollView>
    </View>
  );
}
