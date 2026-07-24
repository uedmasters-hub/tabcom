import { useMemo, forwardRef, useImperativeHandle, type ReactNode } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing,
  interpolate, Extrapolation, type SharedValue,
} from "react-native-reanimated";
import { useChatStore } from "@/stores/chat";
import { Avatar, AVATAR_SIZES } from "./Avatar";

const RAIL_AVATAR = AVATAR_SIZES.lg;      // 60
const RING = 9;                            // 2.5px border + 2px pad, both sides
const RAIL_SLOT = RAIL_AVATAR + RING;      // 69
const PANEL = RAIL_SLOT + 17;              // revealed height

/** No bounce anywhere — timing curves, not springs. */
const EASE = { duration: 260, easing: Easing.out(Easing.cubic) };

export interface ChatSwitcherHandle {
  /** Dismiss the panel. Called whenever the user engages with the
   *  current conversation instead of picking a different one. */
  close: () => void;
}

interface Props {
  activeConversationId: string;
  onSelect?: (conversationId: string) => void;
  enabled: boolean;
  bottomInset: number;
  /** The composer — it is the drag surface. */
  children: ReactNode;
}

/**
 * Hidden chat switcher.
 *
 * Nothing is shown by default: no rail, no handle, no hint. Dragging
 * the composer upward reveals a row of conversation avatars beneath it,
 * staggered left to right. Selecting one swaps the thread in place and
 * the panel closes.
 *
 * Deliberately undiscoverable — treated as a power/privacy affordance
 * rather than primary navigation, so it must not advertise itself.
 */
export const ChatSwitcherSheet = forwardRef<ChatSwitcherHandle, Props>(function ChatSwitcherSheet(
  { activeConversationId, onSelect, enabled, bottomInset, children },
  ref
) {
  const conversations = useChatStore((s) => s.conversations);
  const contacts = useChatStore((s) => s.contacts);
  const communities = useChatStore((s) => s.communities);

  // 0 = fully hidden, 1 = fully revealed.
  const progress = useSharedValue(0);
  const startProgress = useSharedValue(0);

  const rows = useMemo(() => {
    return conversations
      .filter((c) => c.kind !== "community" || (c.communityId && communities[c.communityId]))
      .map((c) => {
        if (c.kind === "community" && c.communityId) {
          const community = communities[c.communityId];
          return {
            id: c.id,
            title: community?.name ?? "Community",
            color: "#2563eb",
            presence: undefined as string | undefined,
            unread: c.unread ?? 0,
            isCommunity: true,
          };
        }
        const contact = contacts.find((x) => x.id === c.contactId);
        return {
          id: c.id,
          title: contact?.alias ?? contact?.name ?? "Unknown",
          color: contact?.color ?? "#2563eb",
          presence: contact?.presence,
          unread: c.unread ?? 0,
          isCommunity: false,
        };
      });
  }, [conversations, contacts, communities]);

  const pan = Gesture.Pan()
    .enabled(enabled)
    // Only claim the gesture on a deliberate vertical drag, so taps on
    // the composer's buttons and text field still work normally.
    .activeOffsetY([-14, 14])
    .failOffsetX([-24, 24])
    .onStart(() => {
      startProgress.value = progress.value;
    })
    .onUpdate((e) => {
      const next = startProgress.value - e.translationY / PANEL;
      // Hard clamp — no rubber-band, since overshoot reads as bounce.
      progress.value = Math.min(1, Math.max(0, next));
    })
    .onEnd((e) => {
      const open = e.velocityY < -320 || (e.velocityY < 320 && progress.value > 0.4);
      progress.value = withTiming(open ? 1 : 0, EASE);
    });

  const panelStyle = useAnimatedStyle(() => ({
    height: progress.value * PANEL,
    opacity: interpolate(progress.value, [0, 0.25], [0, 1], Extrapolation.CLAMP),
  }));

  const close = () => {
    // Cheap to call repeatedly: withTiming on an already-0 value is a
    // no-op, so typing can fire this on every keystroke safely.
    if (progress.value !== 0) progress.value = withTiming(0, EASE);
  };

  useImperativeHandle(ref, () => ({ close }), []);

  const choose = (id: string) => {
    close();
    if (id !== activeConversationId) onSelect?.(id);
  };

  return (
    <GestureDetector gesture={pan}>
      <View style={{ paddingBottom: bottomInset }} className="bg-transparent">
        {children}

        {/* Revealed panel — zero height until dragged, so there is no
            hint of it in the resting state. */}
        <Animated.View style={panelStyle} className="overflow-hidden bg-background">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 6 }}
          >
            {rows.map((r, i) => (
              <StaggeredAvatar
                key={r.id}
                index={i}
                progress={progress}
                row={r}
                active={r.id === activeConversationId}
                onPress={() => choose(r.id)}
              />
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </GestureDetector>
  );
});

/** Each avatar eases in slightly after the one to its left. */
function StaggeredAvatar({
  index, progress, row, active, onPress,
}: {
  index: number;
  progress: SharedValue<number>;
  row: { title: string; color: string; presence?: string; unread: number; isCommunity: boolean };
  active: boolean;
  onPress: () => void;
}) {
  const style = useAnimatedStyle(() => {
    // Later avatars start their reveal later in the drag, producing a
    // left-to-right cascade rather than everything appearing at once.
    const start = Math.min(0.5, index * 0.08);
    const local = interpolate(progress.value, [start, start + 0.5], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: local,
      transform: [{ translateX: (1 - local) * -18 }, { scale: 0.88 + local * 0.12 }],
    };
  });

  return (
    <Animated.View style={style}>
      <Pressable
        onPress={onPress}
        className="mr-2.5 active:opacity-60"
        style={{ width: RAIL_SLOT, height: RAIL_SLOT, alignItems: "center", justifyContent: "center" }}
      >
        <View
          style={
            active
              ? { borderWidth: 2.5, borderColor: "#2563eb", borderRadius: 999, padding: 2 }
              : undefined
          }
        >
          <Avatar
            name={row.title}
            color={row.color}
            size="lg"
            presence={row.presence}
            square={row.isCommunity}
          />
        </View>
        {row.unread > 0 && !active && (
          <View className="absolute top-0 right-0 bg-primary rounded-full min-w-[19px] h-[19px] px-1 items-center justify-center border-2 border-white">
            <Text className="text-white text-[10px] font-bold">{row.unread}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}
