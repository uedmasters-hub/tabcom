/**
 * Long-press context menu for chat messages / media / attachments.
 * Mirrors the extension hover actions, plus Forward and Privacy.
 */
import { Modal, Pressable, Text, View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { Message } from "@tabcom/shared";

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "😮", "😢"] as const;

export type MessageAction =
  | "reply"
  | "forward"
  | "copy"
  | "edit"
  | "delete"
  | "privacy"
  | "privacy_details"
  | "react";

export interface MessageActionAvailability {
  reply: boolean;
  forward: boolean;
  copy: boolean;
  edit: boolean;
  delete: boolean;
  privacy: boolean;
  privacyDetails: boolean;
  react: boolean;
}

interface Props {
  visible: boolean;
  message: Message | null;
  availability: MessageActionAvailability;
  onClose: () => void;
  onAction: (action: MessageAction, emoji?: string) => void;
}

function previewLabel(m: Message): string {
  if (m.deletedAt) return "Deleted message";
  switch (m.kind) {
    case "image":
      return "Photo";
    case "video":
      return "Video";
    case "voice":
      return "Voice message";
    case "file":
      return m.fileName ?? "File";
    case "location":
      return "Location";
    case "contact":
      return m.contactName ? `Contact · ${m.contactName}` : "Contact";
    case "note":
      return m.text?.trim() || "Note";
    case "link":
      return m.text || m.url || "Link";
    default:
      return m.text?.trim() || "Message";
  }
}

type ActionRow = {
  key: MessageAction;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
};

export function MessageActionSheet({
  visible,
  message,
  availability,
  onClose,
  onAction,
}: Props) {
  const insets = useSafeAreaInsets();
  if (!message) return null;

  const rows: ActionRow[] = [];
  if (availability.reply) {
    rows.push({ key: "reply", label: "Reply", icon: "arrow-undo-outline" });
  }
  if (availability.forward) {
    rows.push({ key: "forward", label: "Forward", icon: "arrow-redo-outline" });
  }
  if (availability.copy) {
    rows.push({ key: "copy", label: "Copy", icon: "copy-outline" });
  }
  if (availability.edit) {
    rows.push({ key: "edit", label: "Edit", icon: "pencil-outline" });
  }
  if (availability.privacyDetails) {
    rows.push({
      key: "privacy_details",
      label: "Privacy details",
      icon: "shield-outline",
    });
  }
  if (availability.privacy) {
    rows.push({
      key: "privacy",
      label: "Message privacy",
      icon: "lock-closed-outline",
    });
  }
  if (availability.delete) {
    rows.push({
      key: "delete",
      label: "Delete",
      icon: "trash-outline",
      destructive: true,
    });
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <Text style={styles.preview} numberOfLines={2}>
            {previewLabel(message)}
          </Text>

          {availability.react && (
            <View style={styles.reactions}>
              {QUICK_REACTIONS.map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => {
                    onAction("react", emoji);
                    onClose();
                  }}
                  style={styles.reactionBtn}
                  hitSlop={4}
                >
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <View style={styles.actions}>
            {rows.map((row) => (
              <Pressable
                key={row.key}
                onPress={() => {
                  onAction(row.key);
                  onClose();
                }}
                style={styles.row}
              >
                <Ionicons
                  name={row.icon}
                  size={22}
                  color={row.destructive ? "#dc2626" : "#334155"}
                />
                <Text
                  style={[
                    styles.rowLabel,
                    row.destructive && { color: "#dc2626" },
                  ]}
                >
                  {row.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable onPress={onClose} style={styles.cancel}>
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: 16,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#e2e8f0",
    marginBottom: 12,
  },
  preview: {
    color: "#64748b",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 14,
    paddingHorizontal: 12,
  },
  reactions: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#f8fafc",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
  },
  reactionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  reactionEmoji: {
    fontSize: 26,
  },
  actions: {
    backgroundColor: "#f8fafc",
    borderRadius: 18,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e2e8f0",
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  cancel: {
    marginTop: 10,
    alignItems: "center",
    paddingVertical: 14,
    backgroundColor: "#f1f5f9",
    borderRadius: 16,
  },
  cancelLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#334155",
  },
});
