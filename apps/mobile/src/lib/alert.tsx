/**
 * ══════════════════════════════════════════════════════════════
 *  TabcomAlert — branded modal replacing Alert.alert()
 * ══════════════════════════════════════════════════════════════
 *
 *  Drop-in replacement for React Native's Alert.alert() that uses
 *  Tabcom's design language: white card, ink primary button, rounded
 *  corners, token-based spacing.
 *
 *  Usage:
 *    import { alert } from "@/lib/alert";
 *    alert("Delete chat", "Remove this conversation?", [
 *      { text: "Cancel", style: "cancel" },
 *      { text: "Delete", style: "destructive", onPress: () => {} },
 *    ]);
 *
 *  The <AlertHost /> component must be mounted once in _layout.tsx.
 */

import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  type TextStyle,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
} from "react-native-reanimated";
import { color, radius, space, type as typeTokens, elevation } from "@/theme";

// ── Types ───────────────────────────────────────────────────────────

export interface AlertButton {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
}

interface AlertState {
  visible: boolean;
  title: string;
  message?: string;
  buttons: AlertButton[];
}

type ShowFn = (title: string, message?: string, buttons?: AlertButton[]) => void;

// ── Context ─────────────────────────────────────────────────────────

const AlertContext = createContext<{ show: ShowFn }>({
  show: () => {},
});

// ── Global imperative handle ────────────────────────────────────────

let _globalShow: ShowFn | null = null;

/**
 * Drop-in replacement for Alert.alert(). Works identically:
 *   alert("Title", "Message", [{ text: "OK" }])
 *
 * Must be called after <AlertHost /> is mounted.
 */
export function alert(
  title: string,
  message?: string,
  buttons?: AlertButton[]
): void {
  if (_globalShow) {
    _globalShow(title, message, buttons);
  } else {
    // Fallback to native if AlertHost isn't mounted yet
    const { Alert } = require("react-native");
    Alert.alert(title, message, buttons);
  }
}

// ── Host component (mount once in _layout.tsx) ──────────────────────

const ANIM_IN = 200;
const ANIM_OUT = 150;

export function AlertHost({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AlertState>({
    visible: false,
    title: "",
    message: undefined,
    buttons: [],
  });

  const backdrop = useSharedValue(0);
  const scale = useSharedValue(0.9);
  const opacity = useSharedValue(0);

  const show: ShowFn = useCallback((title, message, buttons) => {
    const btns = buttons ?? [{ text: "OK" }];
    setState({ visible: true, title, message, buttons: btns });
    backdrop.value = withTiming(1, { duration: ANIM_IN, easing: Easing.out(Easing.ease) });
    scale.value = withTiming(1, { duration: ANIM_IN, easing: Easing.out(Easing.ease) });
    opacity.value = withTiming(1, { duration: ANIM_IN, easing: Easing.out(Easing.ease) });
  }, []);

  const dismiss = useCallback((onPress?: () => void) => {
    backdrop.value = withTiming(0, { duration: ANIM_OUT });
    scale.value = withTiming(0.95, { duration: ANIM_OUT });
    opacity.value = withTiming(0, { duration: ANIM_OUT }, () => {
      runOnJS(finishDismiss)(onPress);
    });
  }, []);

  const finishDismiss = (onPress?: () => void) => {
    setState((s) => ({ ...s, visible: false }));
    onPress?.();
  };

  // Register global handle
  React.useEffect(() => {
    _globalShow = show;
    return () => { _globalShow = null; };
  }, [show]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdrop.value * 0.45,
  }));

  const cardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  // Sort buttons: cancel first (left), then default/destructive (right)
  const sortedButtons = [...state.buttons].sort((a, b) => {
    if (a.style === "cancel") return -1;
    if (b.style === "cancel") return 1;
    return 0;
  });

  const hasSingleButton = sortedButtons.length === 1;
  const hasDestructive = sortedButtons.some((b) => b.style === "destructive");

  return (
    <AlertContext.Provider value={{ show }}>
      {children}
      <Modal
        visible={state.visible}
        transparent
        statusBarTranslucent
        animationType="none"
        onRequestClose={() => {
          const cancel = state.buttons.find((b) => b.style === "cancel");
          dismiss(cancel?.onPress);
        }}
      >
        <View style={styles.overlay}>
          {/* Backdrop */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              const cancel = state.buttons.find((b) => b.style === "cancel");
              dismiss(cancel?.onPress);
            }}
          >
            <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }, backdropStyle]} />
          </Pressable>

          {/* Card */}
          <Animated.View style={[styles.card, cardStyle]}>
            {/* Title */}
            <Text style={styles.title}>{state.title}</Text>

            {/* Message */}
            {state.message ? (
              <Text style={styles.message}>{state.message}</Text>
            ) : null}

            {/* Buttons — vertical (full-width action + cancel link) when
                there are 3+ buttons or a primary+cancel pair, so long
                labels never overflow; otherwise the compact row. */}
            {(() => {
              const isCancel = (b: AlertButton) => b.style === "cancel";
              const actions = state.buttons.filter((b) => !isCancel(b));
              const cancels = state.buttons.filter(isCancel);
              const vertical =
                state.buttons.length >= 3 ||
                (state.buttons.length === 2 && cancels.length >= 1);

              if (vertical) {
                return (
                  <View style={styles.buttonColumn}>
                    {actions.map((btn, i) => (
                      <Pressable
                        key={`a${i}`}
                        onPress={() => dismiss(btn.onPress)}
                        style={[
                          styles.buttonV,
                          btn.style === "destructive"
                            ? styles.buttonDestructive
                            : styles.buttonPrimary,
                        ]}
                        android_ripple={{ color: "rgba(255,255,255,0.2)" }}
                      >
                        <Text style={[styles.buttonText, styles.buttonTextPrimary]}>
                          {btn.text}
                        </Text>
                      </Pressable>
                    ))}
                    {cancels.map((btn, i) => (
                      <Pressable
                        key={`c${i}`}
                        onPress={() => dismiss(btn.onPress)}
                        style={styles.buttonLink}
                      >
                        <Text style={[styles.buttonText, styles.buttonTextLink]}>
                          {btn.text}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                );
              }

              return (
                <View style={styles.buttonRow}>
                  {sortedButtons.map((btn, i) => {
                    const isCancelBtn = btn.style === "cancel";
                    const isDestructive = btn.style === "destructive";
                    const btnStyle = isCancelBtn
                      ? styles.buttonCancel
                      : isDestructive
                        ? styles.buttonDestructive
                        : styles.buttonPrimary;
                    const txtStyle = isCancelBtn
                      ? styles.buttonTextCancel
                      : isDestructive
                        ? styles.buttonTextDestructive
                        : styles.buttonTextPrimary;
                    return (
                      <Pressable
                        key={i}
                        onPress={() => dismiss(btn.onPress)}
                        style={[styles.button, btnStyle]}
                        android_ripple={{ color: "rgba(255,255,255,0.2)" }}
                      >
                        <Text style={[styles.buttonText, txtStyle]}>{btn.text}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              );
            })()}
          </Animated.View>
        </View>
      </Modal>
    </AlertContext.Provider>
  );
}

// ── Hook for component-level access ─────────────────────────────────

export function useAlert(): ShowFn {
  return useContext(AlertContext).show;
}

// ── Styles ──────────────────────────────────────────────────────────

const CARD_WIDTH = Math.min(Dimensions.get("window").width - 48, 340);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: space.xxl,
  },

  card: {
    width: CARD_WIDTH,
    backgroundColor: color.white,
    borderRadius: radius.xxl,
    paddingTop: space.xxl + 4,
    paddingHorizontal: space.xxl,
    paddingBottom: space.xl,
    ...elevation.medium,
  },

  title: {
    fontSize: typeTokens.headline.fontSize,
    lineHeight: typeTokens.headline.lineHeight,
    fontWeight: typeTokens.headline.fontWeight as TextStyle["fontWeight"],
    color: color.ink,
    marginBottom: space.sm,
  },

  message: {
    fontSize: typeTokens.body.fontSize,
    lineHeight: typeTokens.body.lineHeight,
    fontWeight: typeTokens.body.fontWeight as TextStyle["fontWeight"],
    color: color.muted,
    marginBottom: space.xxl,
  },

  buttonRow: {
    flexDirection: "row",
    gap: space.sm,
    marginTop: space.md,
  },

  buttonColumn: {
    marginTop: space.md,
    gap: space.sm,
  },

  buttonV: {
    width: "100%",
    height: 52,
    borderRadius: radius.full,
    justifyContent: "center",
    alignItems: "center",
  },

  buttonLink: {
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },

  buttonTextLink: {
    color: color.muted,
  },

  button: {
    flex: 1,
    height: 50,
    borderRadius: radius.full,
    justifyContent: "center",
    alignItems: "center",
  },

  buttonFull: {
    flex: 1,
  },

  buttonPrimary: {
    backgroundColor: color.ink,
  },

  buttonCancel: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
  },

  buttonDestructive: {
    backgroundColor: color.danger,
  },

  buttonText: {
    fontSize: typeTokens.action.fontSize,
    fontWeight: typeTokens.action.fontWeight as TextStyle["fontWeight"],
  },

  buttonTextPrimary: {
    color: color.white,
  },

  buttonTextCancel: {
    color: color.muted,
  },

  buttonTextDestructive: {
    color: color.white,
  },
});
