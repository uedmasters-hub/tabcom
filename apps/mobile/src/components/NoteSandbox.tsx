/**
 * NoteSandbox — read a note and reply to it in place.
 *
 * The point of the sandbox is that a note can be dealt with WITHOUT
 * navigating into the conversation. Opening it reveals the note
 * permanently (`markRead`) and a reply goes out as a normal DM to
 * the same thread, so the conversation history stays coherent —
 * the note and its reply both live in the chat.
 */

import { useEffect, useState } from "react";
import {
  View, Text, Pressable, Image, TextInput,
  ScrollView, StyleSheet,
} from "react-native";
import Animated, {
  useAnimatedStyle,
} from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNotesStore, type NoteCard } from "@/stores/notes";
import { useChatStore } from "@/stores/chat";
import { toast } from "@/lib/toast";
import { color, radius, space, elevation } from "@/theme";
import { formatListTime } from "@/lib/format-time";

interface Props {
  note: NoteCard | null;
  onClose: () => void;
  /** Escape hatch to the full conversation. */
  onOpenConversation: (conversationId: string) => void;
}

export function NoteSandbox({ note, onClose, onOpenConversation }: Props) {
  const insets = useSafeAreaInsets();
  // Tracks the real keyboard height on the UI thread. Works because
  // this overlay lives INSIDE the app's KeyboardProvider tree — a
  // native <Modal> renders in a separate window the provider can't
  // measure, which is why the keyboard used to overflow the sheet.
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const bottomInset = insets.bottom;
  const markRead = useNotesStore((s) => s.markRead);
  const dismiss = useNotesStore((s) => s.dismiss);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  // Opening IS reading — that's the whole interaction.
  useEffect(() => {
    if (note && !note.readAt) markRead(note.id);
  }, [note?.id]);

  // Don't carry a half-typed reply between different notes.
  useEffect(() => {
    setReply("");
  }, [note?.id]);

  // Push the sheet up by exactly the keyboard height. keyboardHeight
  // is negative when open (reanimated convention), so translateY by it
  // lifts the sheet to sit right above the keyboard.
  //
  // This hook (useAnimatedStyle calls useRef internally) MUST run on
  // every render, so it has to sit ABOVE the `!note` early return.
  // Otherwise the hook count changes as the sandbox opens/closes and
  // React throws a Rules-of-Hooks error. It only reads keyboardHeight,
  // never `note`, so running it when note is null is harmless.
  const sheetShift = useAnimatedStyle(() => {
    const kb = keyboardHeight.value;
    const keyboardOpen = kb < 0;
    return {
      transform: [{ translateY: kb }],
      paddingBottom: keyboardOpen ? 0 : bottomInset,
    };
  });

  if (!note) return null;

  const send = () => {
    const text = reply.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      useChatStore.getState().sendText(note.conversationId, text);
      setReply("");
      toast("Reply sent", "success");
      onClose();
    } catch (err) {
      if (__DEV__) console.warn("[tabcom-notes] reply failed:", err);
      toast("Couldn't send reply", "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <Animated.View style={[styles.centre, sheetShift]}>
          <View style={styles.sheet}>
            {/* Header */}
            <View style={styles.header}>
              <View style={[styles.avatar, { backgroundColor: note.fromColor }]}>
                <Text style={styles.avatarText}>
                  {(note.fromName || "?").slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {note.outgoing ? "Your note" : note.fromName}
                </Text>
                <Text style={styles.time}>{formatListTime(note.sentAt)}</Text>
              </View>
              <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
                <Ionicons name="close" size={22} color={color.muted} />
              </Pressable>
            </View>

            {/* Content */}
            <ScrollView
              style={styles.content}
              contentContainerStyle={{ paddingBottom: space.lg }}
              showsVerticalScrollIndicator={false}
            >
              {note.imageUri ? (
                <Image
                  source={{ uri: note.imageUri }}
                  style={styles.image}
                  resizeMode="cover"
                />
              ) : null}
              {note.text ? (
                <Text
                  style={[
                    styles.noteText,
                    note.imageUri ? styles.noteTextWithImage : null,
                  ]}
                >
                  {note.text}
                </Text>
              ) : null}
            </ScrollView>

            {/* Actions */}
            <View style={styles.actions}>
              <Pressable
                style={styles.actionBtn}
                onPress={() => {
                  onClose();
                  onOpenConversation(note.conversationId);
                }}
              >
                <Ionicons name="chatbubble-outline" size={17} color={color.muted} />
                <Text style={styles.actionText}>Open chat</Text>
              </Pressable>
              <Pressable
                style={styles.actionBtn}
                onPress={() => {
                  dismiss(note.id);
                  onClose();
                }}
              >
                <Ionicons name="trash-outline" size={17} color={color.danger} />
                <Text style={[styles.actionText, { color: color.danger }]}>
                  Delete
                </Text>
              </Pressable>
            </View>

            {/* Reply — outgoing notes have no one to reply to */}
            {!note.outgoing && (
              <View style={styles.composer}>
                <TextInput
                  value={reply}
                  onChangeText={setReply}
                  placeholder={`Reply to ${note.fromName}…`}
                  placeholderTextColor={color.muted}
                  style={styles.input}
                  multiline
                  maxLength={2000}
                  onSubmitEditing={send}
                />
                <Pressable
                  onPress={send}
                  disabled={!reply.trim() || sending}
                  style={[
                    styles.sendBtn,
                    (!reply.trim() || sending) && styles.sendBtnOff,
                  ]}
                >
                  <Ionicons name="arrow-up" size={20} color={color.white} />
                </Pressable>
              </View>
            )}
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
  centre: {
    // Must be flex:1 (a DEFINITE height) or the sheet's percentage
    // maxHeight below has nothing to resolve against — RN then leaves
    // the sheet unconstrained, the ScrollView can't size itself, and
    // the note text gets clipped mid-line under the actions row.
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: color.white,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingTop: space.xl,
    // Now that `centre` is flex:1 this resolves against the full screen.
    // 88% leaves the note's origin card peeking behind the scrim so the
    // sheet still reads as an overlay, not a full-screen takeover.
    maxHeight: "88%",
    ...elevation.medium,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    marginRight: space.md,
  },
  avatarText: {
    color: color.white,
    fontSize: 16,
    fontWeight: "700",
  },
  name: {
    color: color.ink,
    fontSize: 17,
    fontWeight: "700",
  },
  time: {
    color: color.muted,
    fontSize: 13,
    marginTop: 1,
  },
  close: {
    padding: 4,
  },
  content: {
    // flexShrink lets the scroll area give up space to the header,
    // actions and composer instead of overflowing past them.
    flexShrink: 1,
    paddingHorizontal: space.xl,
  },
  image: {
    width: "100%",
    height: 220,
    borderRadius: radius.lg,
    marginBottom: space.lg,
    backgroundColor: color.surface,
  },
  noteText: {
    color: color.ink,
    fontSize: 26,
    fontWeight: "700",
    lineHeight: 34,
  },
  noteTextWithImage: {
    fontSize: 17,
    fontWeight: "500",
    lineHeight: 24,
  },
  actions: {
    flexDirection: "row",
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: color.borderLight,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    backgroundColor: color.surface,
  },
  actionText: {
    color: color.muted,
    fontSize: 14,
    fontWeight: "600",
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
    paddingBottom: space.xl,
  },
  input: {
    flex: 1,
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 15,
    color: color.ink,
    maxHeight: 110,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    backgroundColor: color.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnOff: {
    opacity: 0.35,
  },
});
