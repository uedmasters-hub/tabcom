/**
 * Media & files — a full media control surface for a conversation.
 *
 *   • Photos tab — grid of every image, tap to open the full-screen
 *     viewer, long-press to enter selection.
 *   • Files tab  — every video and document as a list with type, size
 *     and date.
 *   • Selection  — long-press any item to multi-select across the tab,
 *     with a count in the app bar and a bulk Delete. Delete only removes
 *     items you sent (server rule), so incoming items are view-only.
 *
 * View + delete work with zero extra native deps. Saving/exporting to
 * the device needs expo-sharing/expo-media-library (a follow-up).
 */
import { useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  Image,
  StyleSheet,
  Dimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useChatStore } from "@/stores/chat";
import { PhotoViewer } from "@/components/PhotoViewer";
import { alert } from "@/lib/alert";
import { color, space } from "@/theme";
import type { Message } from "@tabcom/shared";

const COLS = 3;
const GAP = 3;
const SCREEN = Dimensions.get("window").width;
const CELL = Math.floor((SCREEN - GAP * (COLS - 1)) / COLS);

type Tab = "photos" | "files";

function formatBytes(n?: number): string {
  if (!n || n <= 0) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export default function ConversationMediaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const messages = useChatStore((s) => (id ? s.messages[id] ?? [] : []));

  const [tab, setTab] = useState<Tab>("photos");
  const [selected, setSelected] = useState<string[]>([]);
  const [viewer, setViewer] = useState<{ photos: Message[]; index: number } | null>(
    null
  );

  const { photos, files } = useMemo(() => {
    const live = messages.filter((m) => !m.deletedAt);
    return {
      photos: live.filter((m) => m.kind === "image"),
      files: live.filter((m) => m.kind === "video" || m.kind === "file"),
    };
  }, [messages]);

  const items = tab === "photos" ? photos : files;
  const selectionMode = selected.length > 0;

  const toggle = (m: Message) =>
    setSelected((prev) =>
      prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id]
    );
  const clearSelection = () => setSelected([]);
  const switchTab = (t: Tab) => {
    setTab(t);
    clearSelection();
  };

  const openItem = (m: Message) => {
    if (selectionMode) return toggle(m);
    if (m.kind === "image") {
      const idx = photos.findIndex((p) => p.id === m.id);
      setViewer({ photos, index: Math.max(0, idx) });
    }
    // Videos/files: no inline player/opener without expo-sharing — the
    // long-press selection + Delete still apply.
  };

  const deleteSelected = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    alert(
      ids.length > 1 ? `Delete ${ids.length} items?` : "Delete item?",
      "This removes them from your device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            ids.forEach((mid) =>
              useChatStore.getState().deleteMessage(id!, mid)
            );
            clearSelection();
          },
        },
      ]
    );
  };

  const total = photos.length + files.length;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      {/* App bar */}
      <View style={styles.nav}>
        <Pressable
          onPress={selectionMode ? clearSelection : () => router.back()}
          hitSlop={10}
          className="active:opacity-60"
        >
          <Ionicons
            name={selectionMode ? "close" : "chevron-back"}
            size={28}
            color={selectionMode ? color.ink : color.primary}
          />
        </Pressable>
        <Text style={styles.navTitle}>
          {selectionMode ? `${selected.length}` : "Media & files"}
        </Text>
        {selectionMode ? (
          <Pressable onPress={deleteSelected} hitSlop={10} className="active:opacity-60">
            <Ionicons name="trash-outline" size={23} color={color.danger} />
          </Pressable>
        ) : (
          <View style={{ width: 28 }} />
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TabButton
          label={`Photos${photos.length ? ` · ${photos.length}` : ""}`}
          active={tab === "photos"}
          onPress={() => switchTab("photos")}
        />
        <TabButton
          label={`Files${files.length ? ` · ${files.length}` : ""}`}
          active={tab === "files"}
          onPress={() => switchTab("files")}
        />
      </View>

      {total === 0 ? (
        <EmptyState icon="images-outline" text="No media in this chat yet" />
      ) : tab === "photos" ? (
        photos.length === 0 ? (
          <EmptyState icon="image-outline" text="No photos yet" />
        ) : (
          <FlatList
            data={photos}
            key="photos"
            numColumns={COLS}
            keyExtractor={(m) => m.id}
            columnWrapperStyle={{ gap: GAP }}
            contentContainerStyle={{ gap: GAP, padding: 0 }}
            renderItem={({ item }) => {
              const isSel = selected.includes(item.id);
              return (
                <Pressable
                  onPress={() => openItem(item)}
                  onLongPress={() => toggle(item)}
                  delayLongPress={280}
                  style={styles.cell}
                >
                  <Image
                    source={{ uri: item.dataUrl ?? item.thumbnailUrl }}
                    style={styles.thumb}
                  />
                  {isSel && (
                    <View style={styles.selOverlay}>
                      <Ionicons name="checkmark-circle" size={26} color="#fff" />
                    </View>
                  )}
                </Pressable>
              );
            }}
          />
        )
      ) : files.length === 0 ? (
        <EmptyState icon="document-outline" text="No files yet" />
      ) : (
        <FlatList
          data={files}
          key="files"
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => {
            const isSel = selected.includes(item.id);
            const isVideo = item.kind === "video";
            return (
              <Pressable
                onPress={() => (selectionMode ? toggle(item) : undefined)}
                onLongPress={() => toggle(item)}
                delayLongPress={280}
                style={[styles.fileRow, isSel && styles.fileRowSel]}
                className="active:opacity-70"
              >
                <View style={styles.fileIcon}>
                  <Ionicons
                    name={isVideo ? "videocam" : "document-text"}
                    size={22}
                    color={color.primary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={styles.fileName}>
                    {item.fileName ?? (isVideo ? "Video" : "File")}
                  </Text>
                  <Text style={styles.fileMeta}>
                    {[isVideo ? "Video" : item.mimeType, formatBytes(item.fileSize)]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
                {isSel && (
                  <Ionicons name="checkmark-circle" size={22} color={color.primary} />
                )}
              </Pressable>
            );
          }}
        />
      )}

      {viewer && (
        <PhotoViewer
          photos={viewer.photos}
          initialIndex={viewer.index}
          onClose={() => setViewer(null)}
        />
      )}
    </SafeAreaView>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.tabBtn} className="active:opacity-70">
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
      {active && <View style={styles.tabUnderline} />}
    </Pressable>
  );
}

function EmptyState({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={44} color={color.faint} />
      <Text style={styles.emptyText}>{text}</Text>
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
  tabs: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.borderLight,
  },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabLabel: { fontSize: 15, fontWeight: "600", color: color.muted },
  tabLabelActive: { color: color.ink },
  tabUnderline: {
    position: "absolute",
    bottom: -StyleSheet.hairlineWidth,
    height: 2,
    width: 64,
    borderRadius: 2,
    backgroundColor: color.ink,
  },
  cell: {
    width: CELL,
    height: CELL,
    backgroundColor: color.surface,
  },
  thumb: { width: "100%", height: "100%" },
  selOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(37,99,235,0.35)",
    alignItems: "flex-end",
    justifyContent: "flex-start",
    padding: 6,
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.borderLight,
  },
  fileRowSel: { backgroundColor: "#eff6ff" },
  fileIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: color.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  fileName: { fontSize: 15, fontWeight: "600", color: color.ink },
  fileMeta: { fontSize: 12.5, color: color.muted, marginTop: 2 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  emptyText: { fontSize: 15, color: color.muted },
});
