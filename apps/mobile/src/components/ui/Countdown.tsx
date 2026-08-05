/**
 * ══════════════════════════════════════════════════════════════════
 *  Countdown — reusable, production-ready animated countdown timer
 * ══════════════════════════════════════════════════════════════════
 *
 *  Apple-style digit animation: only the digits that CHANGE animate.
 *  Each outgoing digit slides UP and out while the incoming digit slides
 *  in from BELOW, using the cubic-bezier(0.22, 1, 0.36, 1) curve. Digits
 *  that don't change stay perfectly static. The motion runs on the UI
 *  thread via Reanimated (GPU-accelerated transforms), so it's flicker-
 *  free and holds 60fps, and `tabular-nums` keeps every digit the same
 *  width so there is never a layout shift.
 *
 *  Two ways to drive it:
 *    • expiresAt  — a fixed wall-clock deadline (drift-free, background-
 *                   safe; re-renders never reset it). Best for real
 *                   deadlines like the guest session.
 *    • durationMs — a plain duration you control imperatively via the
 *                   ref: start(), pause(), resume(), reset(ms?).
 *
 *  Both call onComplete() once when the clock reaches zero.
 *
 *  Example (deadline):
 *    <Countdown expiresAt={endsAt} onComplete={endSession} />
 *
 *  Example (controllable):
 *    const ref = useRef<CountdownHandle>(null);
 *    <Countdown ref={ref} durationMs={60000} autoStart={false}
 *               onComplete={() => {}} />
 *    ref.current?.start();  // start / pause() / resume() / reset(30000)
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { View, Text, StyleSheet, type TextStyle } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

// The exact easing requested — cubic-bezier(0.22, 1, 0.36, 1).
const APPLE_EASE = Easing.bezier(0.22, 1, 0.36, 1);
const SLIDE_MS = 360;
const TICK_MS = 250; // sub-second polling so second boundaries never slip

export interface CountdownHandle {
  start: () => void;
  pause: () => void;
  resume: () => void;
  /** Reset to `ms` (or the original duration) and honour autoStart. */
  reset: (ms?: number) => void;
}

interface CountdownProps {
  /** Fixed wall-clock deadline (ms epoch). Takes priority over durationMs. */
  expiresAt?: number;
  /** Duration in ms for an imperatively-controlled timer. */
  durationMs?: number;
  /** Start immediately (durationMs mode only). Default true. */
  autoStart?: boolean;
  /** Fired once when the clock hits zero. */
  onComplete?: () => void;
  /** Fired every time the displayed value changes. */
  onTick?: (msLeft: number) => void;
  /** Style for the digits and separator. */
  digitStyle?: TextStyle;
  /** Height of each digit cell (px). Should match the digit line height. */
  cellHeight?: number;
  /** Optional style for the row container. */
  style?: object;
}

// ── format ──────────────────────────────────────────────────────────

/** "m:ss" — minutes are not zero-padded, matching the guest banner. */
function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── one animated digit ──────────────────────────────────────────────

function FlipDigit({
  char,
  style,
  height,
}: {
  char: string;
  style?: TextStyle;
  height: number;
}) {
  const [outgoing, setOutgoing] = useState<string | null>(null);
  const [current, setCurrent] = useState(char);
  const prev = useRef(char);
  const p = useSharedValue(1); // 1 = settled, 0 = mid-transition

  const clearOutgoing = useCallback(() => setOutgoing(null), []);

  useEffect(() => {
    if (char === prev.current) return; // unchanged digit → stays static
    setOutgoing(prev.current);
    setCurrent(char);
    prev.current = char;
    p.value = 0;
    p.value = withTiming(1, { duration: SLIDE_MS, easing: APPLE_EASE }, (finished) => {
      "worklet";
      if (finished) runOnJS(clearOutgoing)();
    });
  }, [char, clearOutgoing, p]);

  // Incoming: from +height (below) up to 0.
  const incomingStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: height * (1 - p.value) }],
  }));
  // Outgoing: from 0 up to -height, fading out.
  const outgoingStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -height * p.value }],
    opacity: 1 - p.value,
  }));

  return (
    <View style={[styles.cell, { height }]}>
      {outgoing != null && (
        <Animated.Text style={[style, styles.absolute, outgoingStyle]}>
          {outgoing}
        </Animated.Text>
      )}
      <Animated.Text style={[style, incomingStyle]}>{current}</Animated.Text>
    </View>
  );
}

// ── the digit row ───────────────────────────────────────────────────

function FlipClock({
  value,
  digitStyle,
  height,
}: {
  value: string;
  digitStyle?: TextStyle;
  height: number;
}) {
  return (
    <View style={styles.row}>
      {value.split("").map((ch, i) =>
        /\d/.test(ch) ? (
          <FlipDigit key={i} char={ch} style={digitStyle} height={height} />
        ) : (
          <View key={i} style={[styles.cell, { height }]}>
            <Text style={digitStyle}>{ch}</Text>
          </View>
        )
      )}
    </View>
  );
}

// ── the timer ───────────────────────────────────────────────────────

export const Countdown = forwardRef<CountdownHandle, CountdownProps>(
  (
    {
      expiresAt,
      durationMs = 0,
      autoStart = true,
      onComplete,
      onTick,
      digitStyle,
      cellHeight = 28,
      style,
    },
    ref
  ) => {
    const isDeadline = typeof expiresAt === "number";
    const initial = isDeadline ? Math.max(0, expiresAt! - Date.now()) : durationMs;

    const [msLeft, setMsLeft] = useState(initial);
    const endAtRef = useRef<number>(isDeadline ? expiresAt! : Date.now() + durationMs);
    const pausedLeftRef = useRef<number | null>(
      isDeadline || autoStart ? null : durationMs
    );
    const doneRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const stop = useCallback(() => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, []);

    const emit = useCallback(
      (ms: number) => {
        setMsLeft((prev) => (prev === ms ? prev : ms));
        onTick?.(ms);
      },
      [onTick]
    );

    const tick = useCallback(() => {
      const left = Math.max(0, endAtRef.current - Date.now());
      emit(left);
      if (left <= 0 && !doneRef.current) {
        doneRef.current = true;
        stop();
        onComplete?.();
      }
    }, [emit, onComplete, stop]);

    const run = useCallback(() => {
      stop();
      doneRef.current = false;
      tick();
      timerRef.current = setInterval(tick, TICK_MS);
    }, [stop, tick]);

    // Deadline mode: (re)bind whenever the deadline itself changes. A
    // stable expiresAt means re-renders never restart the timer.
    useEffect(() => {
      if (!isDeadline) return;
      endAtRef.current = expiresAt!;
      run();
      return stop;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expiresAt]);

    // Duration mode: honour autoStart on mount.
    useEffect(() => {
      if (isDeadline) return;
      if (autoStart) {
        endAtRef.current = Date.now() + durationMs;
        run();
      } else {
        pausedLeftRef.current = durationMs;
        emit(durationMs);
      }
      return stop;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        start: () => {
          doneRef.current = false;
          endAtRef.current = Date.now() + (pausedLeftRef.current ?? durationMs);
          pausedLeftRef.current = null;
          run();
        },
        pause: () => {
          pausedLeftRef.current = Math.max(0, endAtRef.current - Date.now());
          stop();
        },
        resume: () => {
          if (pausedLeftRef.current == null) return;
          endAtRef.current = Date.now() + pausedLeftRef.current;
          pausedLeftRef.current = null;
          run();
        },
        reset: (ms?: number) => {
          const d = ms ?? durationMs;
          doneRef.current = false;
          if (autoStart) {
            endAtRef.current = Date.now() + d;
            run();
          } else {
            stop();
            pausedLeftRef.current = d;
            emit(d);
          }
        },
      }),
      [autoStart, durationMs, emit, run, stop]
    );

    return (
      <View style={style}>
        <FlipClock value={formatClock(msLeft)} digitStyle={digitStyle} height={cellHeight} />
      </View>
    );
  }
);

Countdown.displayName = "Countdown";

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  cell: {
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  absolute: { position: "absolute" },
});
