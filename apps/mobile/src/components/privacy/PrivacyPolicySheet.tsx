/**
 * Nested privacy policy editor — used for conversation defaults and
 * per-message Advanced Privacy / post-send edits.
 */
import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  Switch,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  DEFAULT_PRIVACY,
  DEFAULT_TTL_MS,
  visibilityLabel,
  type ContentPrivacyPolicy,
  type ConversationPrivacyDefaults,
  type PrivacyVisibility,
} from "@tabcom/shared";
import { color, radius, space } from "@/theme";
import { alert } from "@/lib/alert";

const VISIBILITY_OPTIONS: PrivacyVisibility[] = [
  "always",
  "online_only",
  "view_once",
  "time_limited",
  "private",
  "hide_until_approved",
  "biometric",
];

const TTL_PRESETS = [
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "24 hours", ms: DEFAULT_TTL_MS },
  { label: "7 days", ms: 7 * DEFAULT_TTL_MS },
];

type SoftGateKey = "allowScreenshot" | "allowScreenRecord" | "biometric";

interface Props {
  visible: boolean;
  title?: string;
  mode?: "compose" | "edit" | "defaults";
  initial: ConversationPrivacyDefaults | ContentPrivacyPolicy;
  onClose: () => void;
  onSave: (policy: ContentPrivacyPolicy) => void;
  onRevoke?: () => void;
  onApprove?: () => void;
  showSourceToggle?: boolean;
}

export function PrivacyPolicySheet({
  visible,
  title = "Privacy",
  mode = "compose",
  initial,
  onClose,
  onSave,
  onRevoke,
  onApprove,
  showSourceToggle = mode === "compose" || mode === "edit",
}: Props) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<ContentPrivacyPolicy>(() =>
    normalize(initial)
  );

  useEffect(() => {
    if (visible) setDraft(normalize(initial));
  }, [visible, initial]);

  const set = <K extends keyof ContentPrivacyPolicy>(
    key: K,
    value: ContentPrivacyPolicy[K]
  ) => setDraft((d) => ({ ...d, [key]: value }));

  const softGate = (_key: SoftGateKey, label: string) => {
    alert(
      "Best-effort on this device",
      `${label} depends on OS support and cannot be guaranteed on every phone. Tabcom will apply it where the platform allows.`,
      [{ text: "OK" }]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} className="active:opacity-60">
              <Ionicons name="close" size={24} color={color.muted} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
          >
            {showSourceToggle ? (
              <View style={styles.segment}>
                <Pressable
                  onPress={() => set("source", "inherit")}
                  style={[
                    styles.segBtn,
                    draft.source === "inherit" && styles.segActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.segLabel,
                      draft.source === "inherit" && styles.segLabelActive,
                    ]}
                  >
                    Use chat defaults
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => set("source", "override")}
                  style={[
                    styles.segBtn,
                    draft.source === "override" && styles.segActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.segLabel,
                      draft.source === "override" && styles.segLabelActive,
                    ]}
                  >
                    Custom for this item
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {(draft.source === "override" || mode === "defaults" || !showSourceToggle) && (
              <>
                <Text style={styles.section}>Visibility</Text>
                {VISIBILITY_OPTIONS.map((v) => (
                  <Pressable
                    key={v}
                    onPress={() => {
                      if (v === "biometric") softGate("biometric", "Biometric lock");
                      set("visibility", v);
                    }}
                    style={styles.row}
                    className="active:opacity-70"
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
                    {TTL_PRESETS.map((p) => (
                      <Pressable
                        key={p.ms}
                        onPress={() => set("ttlMs", p.ms)}
                        style={[
                          styles.ttlChip,
                          draft.ttlMs === p.ms && styles.ttlChipActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.ttlText,
                            draft.ttlMs === p.ms && styles.ttlTextActive,
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
                    softGate("allowScreenshot", "Screenshot restriction");
                    set("allowScreenshot", !v);
                  }}
                />
                <Toggle
                  label="Screen recording restricted"
                  value={!draft.allowScreenRecord}
                  onChange={(v) => {
                    softGate("allowScreenRecord", "Screen recording restriction");
                    set("allowScreenRecord", !v);
                  }}
                />
                <Toggle
                  label="Revoke access anytime"
                  value={draft.revocable}
                  onChange={(v) => set("revocable", v)}
                />
              </>
            )}

            {mode === "edit" && onApprove ? (
              <Pressable
                onPress={onApprove}
                style={styles.actionBtn}
                className="active:opacity-70"
              >
                <Ionicons name="checkmark-circle-outline" size={18} color={color.success} />
                <Text style={[styles.actionText, { color: color.success }]}>
                  Approve access
                </Text>
              </Pressable>
            ) : null}

            {mode === "edit" && onRevoke ? (
              <Pressable
                onPress={onRevoke}
                style={styles.actionBtn}
                className="active:opacity-70"
              >
                <Ionicons name="ban-outline" size={18} color={color.danger} />
                <Text style={[styles.actionText, { color: color.danger }]}>
                  Revoke access
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>

          <Pressable
            onPress={() => {
              onSave(
                mode === "defaults"
                  ? { ...draft, source: "override" }
                  : draft
              );
              onClose();
            }}
            style={styles.save}
            className="active:opacity-80"
          >
            <Text style={styles.saveText}>
              {mode === "defaults" ? "Save defaults" : "Apply"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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
    <View style={styles.toggleRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: color.border, true: color.primary }}
        thumbColor={color.white}
      />
    </View>
  );
}

function normalize(
  initial: ConversationPrivacyDefaults | ContentPrivacyPolicy
): ContentPrivacyPolicy {
  return {
    ...DEFAULT_PRIVACY,
    ...initial,
    source: "source" in initial && initial.source ? initial.source : "override",
    ttlMs: initial.ttlMs ?? DEFAULT_TTL_MS,
  };
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(15,23,42,0.45)",
  },
  sheet: {
    backgroundColor: color.background,
    borderTopLeftRadius: radius.xxl + 4,
    borderTopRightRadius: radius.xxl + 4,
    maxHeight: "88%",
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.border,
    marginTop: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  title: {
    flex: 1,
    fontSize: 19,
    fontWeight: "700",
    color: color.ink,
  },
  body: {
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  section: {
    marginTop: space.md,
    marginBottom: space.sm,
    fontSize: 12,
    fontWeight: "700",
    color: color.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  segment: {
    flexDirection: "row",
    backgroundColor: color.surfaceAlt,
    borderRadius: radius.md,
    padding: 3,
    marginBottom: space.sm,
  },
  segBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm + 2,
    alignItems: "center",
  },
  segActive: {
    backgroundColor: color.background,
  },
  segLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: color.muted,
  },
  segLabelActive: { color: color.ink },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.borderLight,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    color: color.ink,
    fontWeight: "500",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  ttlRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: space.sm,
  },
  ttlChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: color.surfaceAlt,
  },
  ttlChipActive: { backgroundColor: color.primaryWash },
  ttlText: { fontSize: 13, fontWeight: "600", color: color.muted },
  ttlTextActive: { color: color.primary },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
    marginTop: 4,
  },
  actionText: { fontSize: 15, fontWeight: "600" },
  save: {
    marginHorizontal: space.lg,
    marginTop: space.xs,
    backgroundColor: color.ink,
    borderRadius: radius.lg,
    paddingVertical: 16,
    alignItems: "center",
  },
  saveText: {
    color: color.white,
    fontSize: 16,
    fontWeight: "700",
  },
});
