/**
 * Read-only privacy details for a protected item.
 */
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  visibilityLabel,
  type ContentPrivacyPolicy,
} from "@tabcom/shared";
import { color, radius, space } from "@/theme";

interface Props {
  visible: boolean;
  policy: ContentPrivacyPolicy | null;
  placeholderReason?: string;
  onClose: () => void;
}

export function PrivacyDetailsSheet({
  visible,
  policy,
  placeholderReason,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  if (!policy) return null;

  const rows: Array<{ label: string; value: string }> = [
    { label: "Visibility", value: visibilityLabel(policy.visibility) },
    {
      label: "Download",
      value: policy.allowDownload ? "Allowed" : "Not allowed",
    },
    {
      label: "Forwarding",
      value: policy.allowForward ? "Allowed" : "Not allowed",
    },
    { label: "Copy", value: policy.allowCopy ? "Allowed" : "Not allowed" },
    {
      label: "Gallery",
      value: policy.showInGallery ? "Visible" : "Hidden",
    },
    {
      label: "Watermark",
      value: policy.watermark ? "On" : "Off",
    },
    {
      label: "Screenshots",
      value: policy.allowScreenshot ? "Allowed" : "Restricted",
    },
    {
      label: "Screen recording",
      value: policy.allowScreenRecord ? "Allowed" : "Restricted",
    },
  ];

  if (policy.expiresAt) {
    rows.push({
      label: "Expires",
      value: new Date(policy.expiresAt).toLocaleString(),
    });
  }
  if (policy.revoked) {
    rows.push({ label: "Status", value: "Access revoked" });
  } else if (
    (policy.visibility === "private" ||
      policy.visibility === "hide_until_approved") &&
    !policy.approved
  ) {
    rows.push({ label: "Status", value: "Awaiting approval" });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Privacy details</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={color.muted} />
            </Pressable>
          </View>
          {placeholderReason ? (
            <Text style={styles.reason}>{placeholderReason}</Text>
          ) : null}
          <ScrollView contentContainerStyle={styles.body}>
            {rows.map((r) => (
              <View key={r.label} style={styles.row}>
                <Text style={styles.label}>{r.label}</Text>
                <Text style={styles.value}>{r.value}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
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
    maxHeight: "70%",
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
  reason: {
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    fontSize: 14,
    color: color.muted,
    fontStyle: "italic",
  },
  body: { paddingHorizontal: space.lg, paddingBottom: space.lg },
  row: {
    flexDirection: "row",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.borderLight,
  },
  label: { flex: 1, fontSize: 15, color: color.muted },
  value: { fontSize: 15, fontWeight: "600", color: color.ink },
});
