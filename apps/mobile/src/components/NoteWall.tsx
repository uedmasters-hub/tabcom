/**
 * NoteWall — the strip of note cards above the chat list.
 *
 * Incoming notes land BLURRED. That's the privacy contract: a note
 * shouldn't be readable from across a room just because the app is
 * open. Tapping opens the sandbox and permanently reveals it.
 *
 * Blur uses expo-blur when available and falls back to a heavy scrim
 * when it isn't, so a missing native module degrades the effect
 * rather than crashing the list (same lazy-guard pattern this
 * codebase already uses for react-native-webrtc).
 */

import { useState } from "react";
import { View, Text, Pressable, Image, ScrollView, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNotesStore, type NoteCard } from "@/stores/notes";
import { color, radius, space, elevation } from "@/theme";
import { formatListTime } from "@/lib/format-time";

// ── Geometry ────────────────────────────────────────────────────────

const CARD_W = 172;
const CARD_H = 210;

interface Props {
  onOpen: (note: NoteCard) => void;
}

export function NoteWall({ onOpen }: Props) {
  const allNotes = useNotesStore((s) => s.notes);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  // The wall only ever shows incoming notes, each once. Filtering here
  // as well as in the store keeps a stray outgoing/duplicate from ever
  // rendering (and from tripping a duplicate React key) between a bad
  // write and the next hydrate.
  const seen = new Set<string>();
  const notes = allNotes.filter(
    (n) => !n.outgoing && !seen.has(n.id) && seen.add(n.id)
  );

  if (notes.length === 0) return null;

  return (
    <View style={styles.wall}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {notes.map((note) => (
          <NoteCardView
            key={note.id}
            note={note}
            menuOpen={menuFor === note.id}
            onToggleMenu={() =>
              setMenuFor((cur) => (cur === note.id ? null : note.id))
            }
            onCloseMenu={() => setMenuFor(null)}
            onOpen={() => {
              setMenuFor(null);
              onOpen(note);
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
}

// ── Single card ─────────────────────────────────────────────────────

function NoteCardView({
  note,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onOpen,
}: {
  note: NoteCard;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onOpen: () => void;
}) {
  const markRead = useNotesStore((s) => s.markRead);
  const dismiss = useNotesStore((s) => s.dismiss);

  // Outgoing notes are mine — never hidden. Incoming stay veiled
  // until explicitly revealed.
  const hidden = !note.readAt && !note.outgoing;

  return (
    <View style={styles.cardWrap}>
      <Pressable onPress={onOpen} style={styles.card}>
        {/* Header */}
        <View style={styles.cardHeader}>
          <View style={[styles.dot, { backgroundColor: note.fromColor }]}>
            <Text style={styles.dotText}>
              {(note.fromName || "?").slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.author} numberOfLines={1}>
            {note.outgoing ? "You" : note.fromName}
          </Text>
          <Pressable
            onPress={onToggleMenu}
            hitSlop={10}
            style={styles.menuBtn}
          >
            <Ionicons name="ellipsis-vertical" size={15} color={color.muted} />
          </Pressable>
        </View>

        {/* Body */}
        <View style={styles.body}>
          {hidden ? (
            /* Hidden: render NOTHING real. A veil over live text can
               leak (blur module missing, low opacity, screenshots).
               The only safe hide is to not draw the content at all. */
            <View style={styles.maskLines}>
              <View style={[styles.maskLine, { width: "85%" }]} />
              <View style={[styles.maskLine, { width: "60%" }]} />
              <View style={[styles.maskLine, { width: "72%" }]} />
            </View>
          ) : (
            <>
              {note.imageUri ? (
                <Image
                  source={{ uri: note.imageUri }}
                  style={styles.image}
                  resizeMode="cover"
                />
              ) : null}
              <Text
                style={[styles.text, note.imageUri ? styles.textWithImage : null]}
                numberOfLines={note.imageUri ? 2 : 5}
              >
                {note.text}
              </Text>
            </>
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.time}>{formatListTime(note.sentAt)}</Text>
          {hidden && (
            <Ionicons name="eye-off-outline" size={15} color={color.muted} />
          )}
        </View>

        {/* Privacy veil — text is already masked above, this is just
            the tap affordance. Fully opaque so nothing shows through. */}
        {hidden && (
          <View style={[StyleSheet.absoluteFill, styles.veilFallback]}>
            <View style={styles.veilCentre}>
              <Ionicons name="eye-outline" size={22} color={color.ink} />
              <Text style={styles.veilLabel}>Tap to read</Text>
            </View>
          </View>
        )}
      </Pressable>

      {/* Contextual menu */}
      {menuOpen && (
        <>
          <Pressable style={styles.menuScrim} onPress={onCloseMenu} />
          <View style={styles.menu}>
            {hidden && (
              <Pressable
                style={styles.menuItem}
                onPress={() => {
                  markRead(note.id);
                  onCloseMenu();
                }}
              >
                <Ionicons name="checkmark-circle-outline" size={17} color={color.ink} />
                <Text style={styles.menuText}>Mark as read</Text>
              </Pressable>
            )}
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                dismiss(note.id);
                onCloseMenu();
              }}
            >
              <Ionicons name="trash-outline" size={17} color={color.danger} />
              <Text style={[styles.menuText, { color: color.danger }]}>
                Delete
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wall: {
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  scroll: {
    paddingHorizontal: space.xl,
    gap: space.md,
  },
  cardWrap: {
    position: "relative",
  },
  card: {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    padding: space.lg,
    overflow: "hidden",
    justifyContent: "space-between",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 7,
  },
  dotText: {
    color: color.white,
    fontSize: 11,
    fontWeight: "700",
  },
  author: {
    flex: 1,
    color: color.ink,
    fontSize: 13,
    fontWeight: "600",
  },
  menuBtn: {
    paddingLeft: 4,
  },
  body: {
    flex: 1,
    justifyContent: "center",
    paddingVertical: space.sm,
  },
  image: {
    width: "100%",
    height: 78,
    borderRadius: radius.md,
    marginBottom: space.sm,
    backgroundColor: color.border,
  },
  text: {
    color: color.ink,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 25,
  },
  textWithImage: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 19,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  time: {
    color: color.muted,
    fontSize: 12,
  },
  veilCentre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  veilLabel: {
    color: color.ink,
    fontSize: 12,
    fontWeight: "600",
  },
  /** No native blur needed — text is masked, so an opaque scrim. */
  veilFallback: {
    backgroundColor: color.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  maskLines: {
    gap: 9,
    width: "100%",
  },
  maskLine: {
    height: 13,
    borderRadius: 7,
    backgroundColor: color.border,
  },
  menuScrim: {
    position: "absolute",
    top: -1000,
    left: -1000,
    right: -1000,
    bottom: -1000,
    zIndex: 10,
  },
  menu: {
    position: "absolute",
    top: 38,
    right: 6,
    backgroundColor: color.white,
    borderRadius: radius.lg,
    paddingVertical: 4,
    minWidth: 160,
    zIndex: 20,
    ...elevation.medium,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  menuText: {
    color: color.ink,
    fontSize: 14,
    fontWeight: "500",
  },
});
