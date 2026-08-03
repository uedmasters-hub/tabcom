/**
 * WhatsApp-style album grid for a multi-select media send.
 * Tapping a cell opens the viewer (photos) or plays video.
 */

import { View, Image, Pressable, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Message } from "@tabcom/shared";

const GRID = 248;

interface Props {
  items: Message[];
  onOpenPhoto: (message: Message) => void;
  onOpenVideo: (message: Message) => void;
}

export function AlbumGrid({ items, onOpenPhoto, onOpenVideo }: Props) {
  const count = items.length;
  if (count === 0) return null;

  const cell = (m: Message, style: object, showMore?: number) => {
    const uri = m.kind === "video" ? (m.thumbnailUrl ?? m.dataUrl) : m.dataUrl;
    return (
      <Pressable
        key={m.id}
        onPress={() =>
          m.kind === "image" ? onOpenPhoto(m) : onOpenVideo(m)
        }
        style={[styles.cell, style]}
      >
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]} />
        )}
        {m.kind === "video" && (
          <View style={styles.play}>
            <Ionicons name="play" size={18} color="#fff" style={{ marginLeft: 2 }} />
          </View>
        )}
        {showMore != null && showMore > 0 && (
          <View style={styles.more}>
            <Text style={styles.moreText}>+{showMore}</Text>
          </View>
        )}
      </Pressable>
    );
  };

  if (count === 1) {
    return (
      <View style={[styles.wrap, { width: GRID, height: GRID }]}>
        {cell(items[0]!, { width: GRID, height: GRID })}
      </View>
    );
  }

  if (count === 2) {
    return (
      <View style={[styles.wrap, styles.row, { width: GRID, height: GRID / 2 }]}>
        {cell(items[0]!, { width: GRID / 2 - 1, height: GRID / 2 })}
        {cell(items[1]!, { width: GRID / 2 - 1, height: GRID / 2 })}
      </View>
    );
  }

  if (count === 3) {
    return (
      <View style={[styles.wrap, { width: GRID, height: GRID }]}>
        <View style={styles.row}>
          {cell(items[0]!, { width: GRID / 2 - 1, height: GRID / 2 - 1 })}
          {cell(items[1]!, { width: GRID / 2 - 1, height: GRID / 2 - 1 })}
        </View>
        {cell(items[2]!, { width: GRID, height: GRID / 2 - 1, marginTop: 2 })}
      </View>
    );
  }

  // 4+: 2x2 with +N on the last cell when more than 4
  const visible = items.slice(0, 4);
  const overflow = count - 4;
  return (
    <View style={[styles.wrap, { width: GRID, height: GRID }]}>
      <View style={styles.row}>
        {cell(visible[0]!, { width: GRID / 2 - 1, height: GRID / 2 - 1 })}
        {cell(visible[1]!, { width: GRID / 2 - 1, height: GRID / 2 - 1 })}
      </View>
      <View style={[styles.row, { marginTop: 2 }]}>
        {cell(visible[2]!, { width: GRID / 2 - 1, height: GRID / 2 - 1 })}
        {cell(
          visible[3]!,
          { width: GRID / 2 - 1, height: GRID / 2 - 1 },
          overflow > 0 ? overflow : undefined
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: "hidden",
    borderRadius: 14,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cell: {
    overflow: "hidden",
    backgroundColor: "#1e293b",
  },
  placeholder: {
    backgroundColor: "#334155",
  },
  play: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  more: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(15,23,42,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  moreText: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
  },
});
