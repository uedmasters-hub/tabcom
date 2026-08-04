/**
 * Conversation-level privacy defaults (Chat Information → Privacy).
 */
import { useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Switch } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  DEFAULT_PRIVACY,
  DEFAULT_TTL_MS,
  visibilityLabel,
  type ConversationPrivacyDefaults,
  type PrivacyVisibility,
} from "@tabcom/shared";
import { useConversationPrivacy } from "@/stores/conversation-privacy";
import { requireRegisteredPrivacy } from "@/lib/privacy/gate";
import { alert } from "@/lib/alert";
import { color, space, radius } from "@/theme";
import { useEffect } from "react";

const VISIBILITY_OPTIONS: PrivacyVisibility[] = [
  "always",
  "online_only",
  "view_once",
  "time_limited",
  "private",
  "hide_until_approved",
  "biometric",
];

export default function ConversationPrivacyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const getDefaults = useConversationPrivacy((s) => s.getDefaults);
  const setDefaults = useConversationPrivacy((s) => s.setDefaults);
  const [draft, setDraft] = useState<ConversationPrivacyDefaults>(() =>
    id ? getDefaults(id) : { ...DEFAULT_PRIVACY }
  );

  useEffect(() => {
    if (!requireRegisteredPrivacy("Privacy controls")) {
      router.back();
    }
  }, []);

  useEffect(() => {
    if (id) setDraft(getDefaults(id));
  }, [id, getDefaults]);

  const set = <K extends keyof ConversationPrivacyDefaults>(
    key: K,
    value: ConversationPrivacyDefaults[K]
  ) => setDraft((d) => ({ ...d, [key]: value }));

  const save = () => {
    if (!id) return;
    setDefaults(id, draft);
    alert("Saved", "New messages in this chat will use these defaults.");
    router.back();
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.nav}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={28} color={color.primary} />
        </Pressable>
        <Text style={styles.navTitle}>Privacy</Text>
        <Pressable onPress={save} hitSlop={10} className="active:opacity-60">
          <Text style={styles.save}>Save</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.intro}>
          Defaults for future messages and media in this conversation. Individual
          items can still override these from Advanced Privacy when sharing.
        </Text>

        <Text style={styles.section}>Default visibility</Text>
        {VISIBILITY_OPTIONS.map((v) => (
          <Pressable
            key={v}
            onPress={() => {
              if (v === "biometric") {
                alert(
                  "Best-effort on this device",
                  "Biometric lock depends on device support."
                );
              }
              set("visibility", v);
            }}
            style={styles.row}
          >
            <Text style={styles.rowLabel}>{visibilityLabel(v)}</Text>
            <Ionicons
              name={draft.visibility === v ? "radio-button-on" : "radio-button-off"}
              size={20}
              color={draft.visibility === v ? color.primary : color.faint}
            />
          </Pressable>
        ))}

        {draft.visibility === "time_limited" ? (
          <View style={styles.ttlRow}>
            {[
              { label: "1h", ms: 60 * 60 * 1000 },
              { label: "24h", ms: DEFAULT_TTL_MS },
              { label: "7d", ms: 7 * DEFAULT_TTL_MS },
            ].map((p) => (
              <Pressable
                key={p.ms}
                onPress={() => set("ttlMs", p.ms)}
                style={[
                  styles.chip,
                  draft.ttlMs === p.ms && styles.chipOn,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    draft.ttlMs === p.ms && styles.chipTextOn,
                  ]}
                >
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Text style={styles.section}>Permissions</Text>
        <Toggle
          label="Allow download"
          value={draft.allowDownload}
          onChange={(v) => set("allowDownload", v)}
        />
        <Toggle
          label="Allow forwarding"
          value={draft.allowForward}
          onChange={(v) => set("allowForward", v)}
        />
        <Toggle
          label="Allow copy"
          value={draft.allowCopy}
          onChange={(v) => set("allowCopy", v)}
        />
        <Toggle
          label="Show in gallery"
          value={draft.showInGallery}
          onChange={(v) => set("showInGallery", v)}
        />
        <Toggle
          label="Watermarked view"
          value={draft.watermark}
          onChange={(v) => set("watermark", v)}
        />
        <Toggle
          label="Screenshot restricted"
          value={!draft.allowScreenshot}
          onChange={(v) => {
            alert(
              "Best-effort on this device",
              "Screenshot restriction depends on OS support."
            );
            set("allowScreenshot", !v);
          }}
        />
        <Toggle
          label="Screen recording restricted"
          value={!draft.allowScreenRecord}
          onChange={(v) => {
            alert(
              "Best-effort on this device",
              "Screen recording restriction depends on OS support."
            );
            set("allowScreenRecord", !v);
          }}
        />
        <Toggle
          label="Revoke access anytime"
          value={draft.revocable}
          onChange={(v) => set("revocable", v)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggle}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: color.border, true: color.primary }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  navTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "700",
    color: color.ink,
  },
  save: { fontSize: 16, fontWeight: "700", color: color.primary },
  body: { paddingHorizontal: space.lg, paddingBottom: 40 },
  intro: {
    fontSize: 14,
    color: color.muted,
    lineHeight: 20,
    marginBottom: space.md,
  },
  section: {
    marginTop: space.lg,
    marginBottom: space.sm,
    fontSize: 12,
    fontWeight: "700",
    color: color.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.borderLight,
  },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: "500", color: color.ink },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  ttlRow: { flexDirection: "row", gap: 8, marginVertical: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: color.surfaceAlt,
  },
  chipOn: { backgroundColor: color.primaryWash },
  chipText: { fontSize: 13, fontWeight: "600", color: color.muted },
  chipTextOn: { color: color.primary },
});
