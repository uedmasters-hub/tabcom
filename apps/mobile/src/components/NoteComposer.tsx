/**
 * NoteComposer — write a note.
 *
 * Deliberately spartan: big text, one optional image, send. A note is
 * a single thought pinned to someone's wall, not a document — the
 * composer should make that obvious by what it doesn't offer.
 */

import { useState } from "react";
import {
  View, Text, Pressable, TextInput, Image,
  StyleSheet, ActivityIndicator, ScrollView,
} from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { pickNoteImage } from "@/lib/media";
import { toast } from "@/lib/toast";
import { color, radius, space, elevation } from "@/theme";

const MAX_NOTE_CHARS = 280;

interface Props {
  visible: boolean;
  onClose: () => void;
  onSend: (text: string, imageDataUrl?: string) => void;
  /** Shown in the header so it's clear whose wall this lands on. */
  peerName?: string;
}

export function NoteComposer({ visible, onClose, onSend, peerName }: Props) {
  const insets = useSafeAreaInsets();
  // Tracks the real keyboard height on the UI thread. This only works
  // because the overlay now lives INSIDE the app's KeyboardProvider
  // tree — the old native <Modal> rendered in a separate window the
  // provider could not measure, so the keyboard covered the sheet.
  // keyboardHeight is negative when open (reanimated convention), so
  // translating by it lifts the sheet to sit right above the keyboard.
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const bottomInset = insets.bottom;
  const sheetShift = useAnimatedStyle(() => {
    const kb = keyboardHeight.value;
    const keyboardOpen = kb < 0;
    return {
      transform: [{ translateY: kb }],
      // Safe-area bottom is inside the keyboard frame when open.
      paddingBottom: keyboardOpen ? space.lg : bottomInset + space.lg,
    };
  });
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | undefined>();
  const [picking, setPicking] = useState(false);

  const reset = () => {
    setText("");
    setImage(undefined);
    setPicking(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const attach = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const media = await pickNoteImage();
      if (media) setImage(media.dataUrl);
    } catch (err) {
      if (__DEV__) console.warn("[tabcom-notes] image pick failed:", err);
      toast("Couldn't attach that image", "error");
    } finally {
      setPicking(false);
    }
  };

  const send = () => {
    const body = text.trim();
    // A note needs SOMETHING — text or an image.
    if (!body && !image) return;
    onSend(body, image);
    reset();
    onClose();
  };

  const canSend = !!text.trim() || !!image;
  const remaining = MAX_NOTE_CHARS - text.length;

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />

        <Animated.View style={sheetShift}>
          <View style={styles.sheet}>
            {/* Header */}
            <View style={styles.header}>
              <Pressable onPress={close} hitSlop={10}>
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
              <View style={styles.titleWrap}>
                <Text style={styles.title}>New note</Text>
                {peerName ? (
                  <Text style={styles.subtitle} numberOfLines={1}>
                    to {peerName}
                  </Text>
                ) : null}
              </View>
              <Pressable
                onPress={send}
                disabled={!canSend}
                style={[styles.sendBtn, !canSend && styles.sendBtnOff]}
              >
                <Text style={styles.sendText}>Send</Text>
              </Pressable>
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {/* Image preview */}
              {image ? (
                <View style={styles.preview}>
                  <Image source={{ uri: image }} style={styles.previewImg} />
                  <Pressable
                    onPress={() => setImage(undefined)}
                    style={styles.previewRemove}
                    hitSlop={8}
                  >
                    <Ionicons name="close" size={16} color={color.white} />
                  </Pressable>
                </View>
              ) : null}

              {/* Text */}
              <TextInput
                value={text}
                onChangeText={(t) => t.length <= MAX_NOTE_CHARS && setText(t)}
                placeholder="What's on your mind?"
                placeholderTextColor={color.muted}
                style={[styles.input, image ? styles.inputSmall : null]}
                multiline
                autoFocus
                textAlignVertical="top"
              />

              {/* Footer */}
              <View style={styles.footer}>
                <Pressable
                  onPress={attach}
                  disabled={picking}
                  style={styles.attachBtn}
                >
                  {picking ? (
                    <ActivityIndicator size="small" color={color.primary} />
                  ) : (
                    <>
                      <Ionicons
                        name={image ? "image" : "image-outline"}
                        size={19}
                        color={color.primary}
                      />
                      <Text style={styles.attachText}>
                        {image ? "Change image" : "Add image"}
                      </Text>
                    </>
                  )}
                </Pressable>

                <Text
                  style={[
                    styles.counter,
                    remaining < 30 && { color: color.danger },
                  ]}
                >
                  {remaining}
                </Text>
              </View>

              <Text style={styles.hint}>
                Notes stay on their chat list until read or deleted.
              </Text>
            </ScrollView>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: color.white,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingTop: space.lg,
    paddingHorizontal: space.xl,
    maxHeight: "92%",
    ...elevation.medium,
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    flexGrow: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.lg,
  },
  cancel: {
    color: color.muted,
    fontSize: 15,
    fontWeight: "500",
    width: 64,
  },
  titleWrap: {
    flex: 1,
    alignItems: "center",
  },
  title: {
    color: color.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  subtitle: {
    color: color.muted,
    fontSize: 12,
    marginTop: 1,
  },
  sendBtn: {
    backgroundColor: color.ink,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: radius.full,
    width: 74,
    alignItems: "center",
  },
  sendBtnOff: {
    opacity: 0.3,
  },
  sendText: {
    color: color.white,
    fontSize: 14,
    fontWeight: "600",
  },
  preview: {
    position: "relative",
    marginBottom: space.md,
  },
  previewImg: {
    width: "100%",
    height: 160,
    borderRadius: radius.lg,
    backgroundColor: color.surface,
  },
  previewRemove: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: "rgba(15,23,42,0.65)",
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    color: color.ink,
    fontSize: 24,
    fontWeight: "600",
    lineHeight: 32,
    minHeight: 130,
    maxHeight: 220,
  },
  inputSmall: {
    fontSize: 17,
    fontWeight: "500",
    lineHeight: 24,
    minHeight: 70,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.md,
  },
  attachBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: radius.full,
    backgroundColor: color.surface,
    minWidth: 130,
    justifyContent: "center",
  },
  attachText: {
    color: color.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  counter: {
    color: color.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  hint: {
    color: color.muted,
    fontSize: 12,
    textAlign: "center",
    marginTop: space.md,
  },
});
