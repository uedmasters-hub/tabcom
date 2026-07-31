/**
 * ══════════════════════════════════════════════════════════════
 *  TOAST — lightweight notification toasts
 * ══════════════════════════════════════════════════════════════
 *
 *  Slides down from top, auto-dismisses. No third-party deps.
 *
 *  Usage:
 *    import { toast } from "@/lib/toast";
 *    toast("Chat refreshed");
 *    toast("Connection restored", "success");
 *    toast("Message failed to send", "error");
 *
 *  Mount <ToastHost /> once in _layout.tsx.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Text, StyleSheet, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  runOnJS,
  Easing,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { color, radius, space, type as typeTokens, elevation, motion } from "@/theme";

// ── Types ───────────────────────────────────────────────────────────

type ToastVariant = "info" | "success" | "error";

interface ToastEntry {
  id: number;
  message: string;
  variant: ToastVariant;
}

const ICON: Record<ToastVariant, { name: string; color: string }> = {
  info:    { name: "checkmark-circle", color: color.primary },
  success: { name: "checkmark-circle", color: color.success },
  error:   { name: "alert-circle",     color: color.danger },
};

const DURATION = 2200;
const ANIM_IN = 280;
const ANIM_OUT = 220;
const EASE_OUT = Easing.bezier(0.25, 0.1, 0.25, 1);
const EASE_IN = Easing.bezier(0.55, 0.05, 0.68, 0.19);

// ── Global imperative handle ────────────────────────────────────────

let _globalShow: ((message: string, variant?: ToastVariant) => void) | null = null;
let _nextId = 0;

export function toast(message: string, variant: ToastVariant = "info"): void {
  _globalShow?.(message, variant);
}

// ── Single toast renderer ───────────────────────────────────────────

function ToastItem({
  entry,
  bottomOffset,
  onDone,
}: {
  entry: ToastEntry;
  bottomOffset: number;
  onDone: (id: number) => void;
}) {
  const translateY = useSharedValue(80);
  const opacity = useSharedValue(0);

  useEffect(() => {
    // Slide up from below
    translateY.value = withTiming(0, { duration: ANIM_IN, easing: EASE_OUT });
    opacity.value = withTiming(1, { duration: ANIM_IN, easing: EASE_OUT });

    // Auto-dismiss — dissolve in place
    const timer = setTimeout(() => {
      opacity.value = withTiming(0, { duration: ANIM_OUT, easing: EASE_IN }, () => {
        runOnJS(onDone)(entry.id);
      });
    }, DURATION);

    return () => clearTimeout(timer);
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const icon = ICON[entry.variant];

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { bottom: bottomOffset },
        animStyle,
      ]}
    >
      <View style={styles.toast}>
      <Ionicons
        name={icon.name as any}
        size={20}
        color={icon.color}
        style={{ marginRight: 10 }}
      />
      <Text style={styles.text} numberOfLines={2}>
        {entry.message}
      </Text>
      </View>
    </Animated.View>
  );
}

// ── Host component ──────────────────────────────────────────────────

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const insets = useSafeAreaInsets();

  const show = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = ++_nextId;
    setToasts([{ id, message, variant }]);
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    _globalShow = show;
    return () => { _globalShow = null; };
  }, [show]);

  return (
    <>
      {children}
      {toasts.map((t) => (
        <ToastItem
          key={t.id}
          entry={t}
          bottomOffset={Math.max(insets.bottom, 8) + 68}
          onDone={remove}
        />
      ))}
    </>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const { width } = Dimensions.get("window");

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 9999,
  },

  toast: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: color.ink,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: radius.full,
    ...elevation.medium,
  },

  text: {
    color: color.white,
    fontSize: typeTokens.body.fontSize,
    fontWeight: "500",
    lineHeight: typeTokens.body.lineHeight,
  },
});
