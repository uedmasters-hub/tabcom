import { useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolateColor,
  Easing,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePendingCount } from "@/hooks/useConnections";
import { useChatStore } from "@/stores/chat";
import { color, space, radius, type as typeTokens, motion } from "@/theme";

// ── Tab config ──────────────────────────────────────────────────────

interface TabDef {
  name: string;
  title: string;
  icon: string;         // Ionicons outline name
  iconFocused: string;  // Ionicons filled name
  size: number;
}

const TABS: TabDef[] = [
  { name: "index",       title: "Chat",      icon: "chatbubbles-outline", iconFocused: "chatbubbles", size: 24 },
  { name: "communities", title: "Community",  icon: "people-outline",      iconFocused: "people",      size: 24 },
  { name: "contacts",    title: "Contacts",   icon: "call-outline",        iconFocused: "call",        size: 23 },
  { name: "settings",    title: "Settings",   icon: "settings-outline",    iconFocused: "settings",    size: 23 },
];

// ── Animated tab button ─────────────────────────────────────────────

const EASE = Easing.bezier(0.25, 0.1, 0.25, 1);

function TabButton({
  tab,
  focused,
  badge,
  onPress,
}: {
  tab: TabDef;
  focused: boolean;
  badge?: number;
  onPress: () => void;
}) {
  const progress = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(focused ? 1 : 0, {
      duration: motion.fast,
      easing: EASE,
    });
  }, [focused]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + progress.value * 0.12 }],
  }));

  const pillStyle = useAnimatedStyle(() => ({
    opacity: progress.value * 0.65,
    transform: [{ scaleX: 0.6 + progress.value * 0.4 }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: 0.45 + progress.value * 0.55,
    transform: [{ translateY: progress.value * -1 }],
  }));

  return (
    <Pressable onPress={onPress} style={styles.tab}>
      <View style={styles.iconWrap}>
        {/* Active indicator pill — sits behind the icon */}
        <Animated.View style={[styles.pill, pillStyle]} />

        <Animated.View style={iconStyle}>
          <Ionicons
            name={(focused ? tab.iconFocused : tab.icon) as any}
            size={tab.size}
            color={focused ? color.primary : color.subtle}
          />
        </Animated.View>

        {/* Badge */}
        {badge != null && badge > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {badge > 99 ? "99+" : badge}
            </Text>
          </View>
        )}
      </View>

      <Animated.Text
        style={[
          styles.label,
          { color: focused ? color.primary : color.subtle },
          labelStyle,
        ]}
        numberOfLines={1}
      >
        {tab.title}
      </Animated.Text>
    </Pressable>
  );
}

// ── Tab layout ──────────────────────────────────────────────────────

export default function TabsLayout() {
  const pending = usePendingCount();
  const insets = useSafeAreaInsets();
  const unread = useChatStore((s) =>
    s.conversations.reduce((sum, c) => sum + (c.unread ?? 0), 0)
  );

  useEffect(() => {
    void import("@/lib/notifications").then(({ setBadgeCount }) =>
      setBadgeCount(unread + pending)
    );
  }, [unread, pending]);

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigation }) => (
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          {TABS.map((tab, i) => {
            const focused = state.index === i;
            const badge = tab.name === "index" && pending > 0 ? pending : undefined;

            return (
              <TabButton
                key={tab.name}
                tab={tab}
                focused={focused}
                badge={badge}
                onPress={() => {
                  const event = navigation.emit({
                    type: "tabPress",
                    target: state.routes[i].key,
                    canPreventDefault: true,
                  });
                  if (!event.defaultPrevented) {
                    navigation.navigate(state.routes[i].name);
                  }
                }}
              />
            );
          })}
        </View>
      )}
    >
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} />
      ))}
    </Tabs>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const PILL_WIDTH = 56;
const PILL_HEIGHT = 30;

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: color.white,
    borderTopWidth: 1,
    borderTopColor: color.borderLight,
    paddingTop: 6,
  },

  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 4,
  },

  iconWrap: {
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },

  pill: {
    position: "absolute",
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    borderRadius: radius.full,
    backgroundColor: color.primaryWash,
  },

  label: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
    letterSpacing: 0.1,
  },

  badge: {
    position: "absolute",
    top: -4,
    right: -2,
    backgroundColor: color.primary,
    borderRadius: radius.full,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },

  badgeText: {
    color: color.white,
    fontSize: 10,
    fontWeight: "700",
  },
});
