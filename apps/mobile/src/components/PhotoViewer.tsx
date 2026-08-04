/**
 * Full-screen photo viewer with horizontal swipe between album photos.
 * Videos/files are not included in the swipe set — only kind === "image".
 */

import { useRef, useState } from "react";
import {
  Modal, View, Image, Pressable, Text, FlatList,
  useWindowDimensions, StyleSheet, type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { Message } from "@tabcom/shared";

interface Props {
  photos: Message[];
  /** Index into `photos` to open on. */
  initialIndex: number;
  onClose: () => void;
  /** Subtle watermark overlay when policy requires it. */
  watermark?: boolean;
  watermarkLabel?: string;
}

export function PhotoViewer({
  photos,
  initialIndex,
  onClose,
  watermark,
  watermarkLabel,
}: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(
    Math.min(Math.max(initialIndex, 0), Math.max(photos.length - 1, 0))
  );
  const listRef = useRef<FlatList>(null);

  if (photos.length === 0) return null;

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== index && next >= 0 && next < photos.length) setIndex(next);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.topBar}>
          <Text style={styles.counter}>
            {photos.length > 1 ? `${index + 1} / ${photos.length}` : "Photo"}
          </Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
        </View>

        <FlatList
          ref={listRef}
          data={photos}
          keyExtractor={(m) => m.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={index}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={onScrollEnd}
          renderItem={({ item }) => (
            <View style={{ width, height: height - insets.top - insets.bottom - 56 }}>
              <Image
                source={{ uri: item.dataUrl }}
                style={styles.image}
                resizeMode="contain"
              />
              {watermark ? (
                <View pointerEvents="none" style={styles.watermark}>
                  <Text style={styles.watermarkText}>
                    {watermarkLabel ? `@${watermarkLabel}` : "Tabcom"}
                  </Text>
                </View>
              ) : null}
            </View>
          )}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  topBar: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  counter: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  closeBtn: {
    padding: 4,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  watermark: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  watermarkText: {
    color: "rgba(255,255,255,0.28)",
    fontSize: 18,
    fontWeight: "700",
    transform: [{ rotate: "-28deg" }],
  },
});
