/**
 * Toast — single pill, no child components, no double-mount.
 *
 * ONE Animated.View lives in the host permanently. show() drives
 * its opacity/translateY via shared values. No child component,
 * no useEffect for animation, no key changes, no unmount/remount.
 * Double-fire is blocked by a synchronous ref lock.
 */

import React, { useCallback, useEffect, useRef } from "react";
import { Text, View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { color, radius, type as typeTokens, elevation } from "@/theme";

type ToastVariant = "info" | "success" | "error";

const ICON_MAP: Record<ToastVariant, { name: string; tint: string }> = {
  info:    { name: "checkmark-circle", tint: color.primary },
  success: { name: "checkmark-circle", tint: color.success },
  error:   { name: "alert-circle",     tint: color.danger },
};

const VISIBLE_MS = 2000;
const FADE_IN = 250;
const FADE_OUT = 300;
const EASE = Easing.bezier(0.25, 0.1, 0.25, 1);

// ── Global handle ───────────────────────────────────────────────────

let _show: ((msg: string, v?: ToastVariant) => void) | null = null;

export function toast(msg: string, variant: ToastVariant = "info"): void {
  _show?.(msg, variant);
}

// ── Host (mount once in _layout.tsx) ────────────────────────────────

export function ToastHost({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);
  const msgRef = useRef("");
  const variantRef = useRef<ToastVariant>("info");
  const [, forceRender] = React.useState(0);
  const busy = useRef(false);

  const show = useCallback((msg: string, variant: ToastVariant = "info") => {
    if (busy.current) return;
    busy.current = true;
    msgRef.current = msg;
    variantRef.current = variant;
    forceRender((n) => n + 1);

    // Fade in
    translateY.value = 20;
    opacity.value = withTiming(1, { duration: FADE_IN, easing: EASE });
    translateY.value = withTiming(0, { duration: FADE_IN, easing: EASE });

    // Hold, then fade out
    setTimeout(() => {
      opacity.value = withTiming(0, { duration: FADE_OUT, easing: EASE });
      translateY.value = withTiming(10, { duration: FADE_OUT, easing: EASE });
      setTimeout(() => {
        busy.current = false;
      }, FADE_OUT);
    }, VISIBLE_MS);
  }, []);

  useEffect(() => {
    _show = show;
    return () => { _show = null; };
  }, [show]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const icon = ICON_MAP[variantRef.current];
  const bottom = Math.max(insets.bottom, 8) + 68;

  return (
    <>
      {children}
      <Animated.View
        pointerEvents="none"
        style={[styles.wrapper, { bottom }, animStyle]}
      >
        <View style={styles.pill}>
          <Ionicons
            name={icon.name as any}
            size={18}
            color={icon.tint}
            style={{ marginRight: 8 }}
          />
          <Text style={styles.text}>{msgRef.current}</Text>
        </View>
      </Animated.View>
    </>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 9999,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: color.ink,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: radius.full,
    ...elevation.medium,
  },
  text: {
    color: color.white,
    fontSize: typeTokens.body.fontSize,
    fontWeight: "500",
  },
});
