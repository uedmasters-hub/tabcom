/**
 * Chat Information — DM only. Privacy lives one level deeper.
 */
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useChatStore } from "@/stores/chat";
import { Avatar } from "@/components/Avatar";
import { requireRegisteredPrivacy } from "@/lib/privacy/gate";
import { color, space, radius } from "@/theme";
import { contactLabel } from "@tabcom/shared";

export default function ChatInfoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const conversation = useChatStore((s) =>
    s.conversations.find((c) => c.id === id)
  );
  const contact = useChatStore((s) =>
    s.contacts.find((c) => c.id === conversation?.contactId)
  );
  const messages = useChatStore((s) => (id ? s.messages[id] ?? [] : []));

  if (!conversation || conversation.kind !== "dm" || !contact) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.muted}>Chat not found</Text>
      </SafeAreaView>
    );
  }

  const mediaCount = messages.filter(
    (m) => m.kind === "image" || m.kind === "video" || m.kind === "file"
  ).length;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.nav}>
        <Pressable onPress={() => router.back()} hitSlop={10} className="active:opacity-60">
          <Ionicons name="chevron-back" size={28} color={color.primary} />
        </Pressable>
        <Text style={styles.navTitle}>Chat information</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.hero}>
          <Avatar
            name={contactLabel(contact)}
            color={contact.color}
            photo={contact.photo}
            size="xl"
          />
          <Text style={styles.name}>{contactLabel(contact)}</Text>
          <Text style={styles.handle}>@{contact.username}</Text>
        </View>

        <Pressable
          onPress={() => router.push(`/profile/${contact.username}` as any)}
          style={styles.row}
          className="active:opacity-70"
        >
          <Ionicons name="person-outline" size={20} color={color.ink} />
          <Text style={styles.rowLabel}>View profile</Text>
          <Ionicons name="chevron-forward" size={18} color={color.faint} />
        </Pressable>

        <Pressable
          onPress={() => {
            if (!requireRegisteredPrivacy("Privacy controls")) return;
            router.push(`/conversation/privacy/${id}` as any);
          }}
          style={styles.row}
          className="active:opacity-70"
        >
          <Ionicons name="shield-outline" size={20} color={color.ink} />
          <View style={styles.rowCopy}>
            <Text style={styles.rowLabel}>Privacy</Text>
            <Text style={styles.rowSub}>Defaults for messages in this chat</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={color.faint} />
        </Pressable>

        <Pressable
          onPress={() => router.push(`/conversation/media/${id}` as any)}
          style={styles.row}
          className="active:opacity-70"
        >
          <Ionicons name="images-outline" size={20} color={color.ink} />
          <View style={styles.rowCopy}>
            <Text style={styles.rowLabel}>Media & files</Text>
            <Text style={styles.rowSub}>{mediaCount} items in this chat</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={color.faint} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.background },
  muted: { textAlign: "center", marginTop: 40, color: color.muted },
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
  body: { paddingBottom: 40 },
  hero: {
    alignItems: "center",
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
  },
  name: {
    marginTop: 12,
    fontSize: 22,
    fontWeight: "700",
    color: color.ink,
  },
  handle: { marginTop: 4, fontSize: 14, color: color.muted },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: space.lg,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.borderLight,
  },
  rowCopy: { flex: 1 },
  rowLabel: { fontSize: 16, fontWeight: "600", color: color.ink },
  rowSub: { fontSize: 13, color: color.muted, marginTop: 2 },
});
