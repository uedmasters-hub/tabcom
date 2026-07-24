import { useCallback, useEffect, useRef } from "react";
import { Text, View, Image, Pressable, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue, useAnimatedStyle, useDerivedValue,
  withSpring, interpolate, interpolateColor, Extrapolation,
  runOnJS, type SharedValue,
} from "react-native-reanimated";
import { useOnboarding } from "@/lib/onboarding";

/**
 * Onboarding — one circular, auto-advancing pager.
 *
 * ARCHITECTURE
 * Everything derives from ONE shared value: `offset`, the position in
 * pages as a FRACTION (2.37 = 37% of the way from page 2 to page 3).
 * Cards, illustrations, copy and dots all read that same number, so
 * every element stays continuously connected to the finger rather than
 * reacting to a page-changed event.
 *
 * CIRCULARITY
 * `offset` is UNBOUNDED and grows forever (…3, 4, 5…). Each card works
 * out where to sit from its WRAPPED distance to the current offset, so
 * the card leaving on the left reappears on the right with no seam and
 * no special case at the boundary. That is what makes the loop
 * genuinely endless in both directions instead of rewinding.
 *
 * `offset` lives on the UI thread — gesture writes it, spring animates
 * it, styles derive from it — so dragging triggers zero React
 * re-renders and no page is ever rebuilt mid-swipe.
 */

const PAGES = [
  {
    key: "privacy",
    image: require("../../assets/images/onboarding-1.png"),
    title: "Privacy First",
    body: "Your conversations stay yours with secure, encrypted messaging built for peace of mind.",
  },
  {
    key: "one-place",
    image: require("../../assets/images/onboarding-2.png"),
    title: "Everything in\nOne Place",
    body: "Chat, receive browser notifications, and stay connected seamlessly across your devices.",
  },
  {
    key: "community",
    image: require("../../assets/images/onboarding-3.png"),
    title: "Build Your\nCommunity",
    body: "Create groups, manage channels, and bring people together in one organized space.",
  },
  {
    key: "messaging",
    image: require("../../assets/images/onboarding-4.png"),
    title: "Messaging\nWithout Limits",
    body: "Calls, chats, files, media, and communities—all in one modern messaging experience.",
  },
] as const;

const N = PAGES.length;

/**
 * Settle spring. The brief asked for "medium stiffness, low damping"
 * but also "without excessive bouncing" — those pull against each
 * other, so this sits at the restrained end: enough give to feel
 * physical, not enough to visibly oscillate.
 */
const SETTLE = { damping: 18, stiffness: 130, mass: 0.85 } as const;
/** Gentler and slower for unattended auto-advance, which should drift
 *  rather than snap — it isn't responding to anyone's finger. */
const DRIFT = { damping: 22, stiffness: 70, mass: 1 } as const;

const AUTOPLAY_MS = 3800;
/** Idle time after a manual drag before autoplay resumes. */
const RESUME_MS = 6000;

const CARD_RATIO = 0.635;
const CARD_ASPECT = 0.79;
/** Peak tilt of an off-centre card, in degrees. Straightens to 0 as it
 *  reaches the middle, giving the row a subtle circular sweep. */
const TILT = 4;

/** Shortest signed distance from `index` to `offset` on a ring of N.
 *  Result is within ±N/2, so cards always travel the short way round
 *  and the wrap is invisible. */
function wrap(index: number, offset: number): number {
  "worklet";
  const raw = index - offset;
  return ((((raw + N / 2) % N) + N) % N) - N / 2;
}

export default function OnboardingScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const markSeen = useOnboarding((s) => s.markSeen);

  const CARD_W = width * CARD_RATIO;
  const STRIDE = CARD_W + 16;

  /** Position in pages, fractional and unbounded. Single source of truth. */
  const offset = useSharedValue(0);
  const start = useSharedValue(0);
  /** True while a finger is down — pauses autoplay without React state. */
  const dragging = useSharedValue(false);

  const autoplay = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeAt = useRef(0);

  const advance = useCallback(() => {
    // Skip a beat if the user touched recently: autoplay should never
    // fight someone who is actively exploring.
    if (dragging.value || Date.now() < resumeAt.current) return;
    offset.value = withSpring(Math.round(offset.value) + 1, DRIFT);
  }, [dragging, offset]);

  useEffect(() => {
    autoplay.current = setInterval(advance, AUTOPLAY_MS);
    return () => {
      if (autoplay.current) clearInterval(autoplay.current);
    };
  }, [advance]);

  const pauseAutoplay = useCallback(() => {
    resumeAt.current = Date.now() + RESUME_MS;
  }, []);

  /** Leave onboarding. Marks seen first so the routing gate lets the
   *  navigation stand instead of bouncing straight back here. */
  const getStarted = useCallback(() => {
    void markSeen();
    router.replace("/(auth)/welcome" as any);
  }, [markSeen, router]);

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-24, 24])
    .onStart(() => {
      dragging.value = true;
      start.value = offset.value;
    })
    .onUpdate((e) => {
      // No clamping and no edge resistance: the ring has no ends.
      offset.value = start.value - e.translationX / STRIDE;
    })
    .onEnd((e) => {
      // Project where the flick would carry, then settle on the nearest
      // page — a fast flick advances from barely past centre, a slow
      // drag resolves to whatever is closest.
      const projected = offset.value - (e.velocityX / STRIDE) * 0.18;
      offset.value = withSpring(Math.round(projected), SETTLE);
    })
    .onFinalize(() => {
      dragging.value = false;
      runOnJS(pauseAutoplay)();
    });

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Fixed: logo. Never moves, anchoring the whole experience. */}
      <View className="items-center pt-6 pb-2">
        <Image
          source={require("../../assets/images/icon.png")}
          style={{ width: 62, height: 62, borderRadius: 15 }}
          resizeMode="contain"
        />
      </View>

      <GestureDetector gesture={pan}>
        <View className="flex-1 justify-center">
          <View style={{ height: CARD_W / CARD_ASPECT }}>
            {PAGES.map((p, i) => (
              <Card
                key={p.key}
                index={i}
                offset={offset}
                width={CARD_W}
                stride={STRIDE}
                screenWidth={width}
                aspect={CARD_ASPECT}
                image={p.image}
              />
            ))}
          </View>

          <Indicator offset={offset} />

          {/* Fixed frame, animated contents — so the layout never jumps
              as titles change line count. */}
          <View style={{ height: 190 }} className="px-8 pt-9">
            {PAGES.map((p, i) => (
              <Copy key={p.key} index={i} offset={offset} title={p.title} body={p.body} />
            ))}
          </View>
        </View>
      </GestureDetector>

      {/* Fixed: CTA. Same position, size and label throughout — the
          carousel is optional exploration, this is always the way out. */}
      <View className="px-8 pb-8 pt-2">
        <Pressable
          onPress={getStarted}
          className="flex-row items-center justify-center gap-3 bg-ink rounded-full py-[19px] active:opacity-85 self-center px-14"
        >
          <Text className="text-white font-bold text-[17px]">Get started</Text>
          <Ionicons name="arrow-forward" size={19} color="#fff" />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/**
 * One glass card. Position, scale, tilt and opacity all interpolate off
 * the shared offset, so a card is never "the active one" as a state —
 * it is simply however close it currently is to centre.
 */
function Card({
  index, offset, width, stride, screenWidth, aspect, image,
}: {
  index: number;
  offset: SharedValue<number>;
  width: number;
  stride: number;
  screenWidth: number;
  aspect: number;
  image: number;
}) {
  const height = width / aspect;
  const left = (screenWidth - width) / 2;

  const style = useAnimatedStyle(() => {
    const d = wrap(index, offset.value);
    const a = Math.abs(d);
    return {
      transform: [
        { translateX: d * stride },
        // Tilts away from centre and straightens on arrival, so the row
        // reads as a shallow arc rather than a flat filmstrip.
        { rotateZ: `${interpolate(d, [-1, 0, 1], [-TILT, 0, TILT], Extrapolation.CLAMP)}deg` },
        { scale: interpolate(a, [0, 1, 2], [1, 0.95, 0.9], Extrapolation.CLAMP) },
      ],
      opacity: interpolate(a, [0, 1, 2], [1, 0.8, 0.6], Extrapolation.CLAMP),
      // Keeps the centre card above its neighbours as they cross.
      zIndex: Math.round(10 - a * 5),
    };
  });

  // The illustration drifts slightly AGAINST the swipe and scales a
  // touch — depth, not parallax.
  const imageStyle = useAnimatedStyle(() => {
    const d = wrap(index, offset.value);
    return {
      transform: [
        { translateX: interpolate(d, [-1, 0, 1], [10, 0, -10], Extrapolation.CLAMP) },
        { scale: interpolate(Math.abs(d), [0, 1], [1, 0.94], Extrapolation.CLAMP) },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        style,
        {
          position: "absolute",
          left,
          width,
          height,
          borderRadius: 26,
          overflow: "hidden",
          backgroundColor: "#f4f7fa",
        },
      ]}
    >
      <Animated.Image
        source={image}
        style={[imageStyle, { width: "100%", height: "100%" }]}
        resizeMode="cover"
        // Every page is mounted from the start and never unmounted, so
        // there is no decode work mid-swipe.
        fadeDuration={0}
      />
    </Animated.View>
  );
}

/** Title + body for one page, cross-fading against the drag. */
function Copy({
  index, offset, title, body,
}: {
  index: number;
  offset: SharedValue<number>;
  title: string;
  body: string;
}) {
  const style = useAnimatedStyle(() => {
    const d = wrap(index, offset.value);
    return {
      opacity: interpolate(Math.abs(d), [0, 0.65], [1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: interpolate(d, [-1, 0, 1], [16, 0, -16], Extrapolation.CLAMP) },
      ],
    };
  });

  return (
    <Animated.View style={[style, { position: "absolute", left: 32, right: 32, top: 36 }]}>
      <Text className="text-ink text-[38px] font-extrabold text-center leading-[46px] tracking-tight">
        {title}
      </Text>
      <Text className="text-muted text-[17px] leading-[26px] text-center mt-4">
        {body}
      </Text>
    </Animated.View>
  );
}

/** Dots whose active pill grows and slides continuously with the drag,
 *  rather than switching once a page lands. */
function Indicator({ offset }: { offset: SharedValue<number> }) {
  return (
    <View className="flex-row items-center justify-center gap-2 mt-9">
      {PAGES.map((p, i) => (
        <Dot key={p.key} index={i} offset={offset} />
      ))}
    </View>
  );
}

function Dot({ index, offset }: { index: number; offset: SharedValue<number> }) {
  const d = useDerivedValue(() => Math.abs(wrap(index, offset.value)));

  const style = useAnimatedStyle(() => ({
    width: interpolate(d.value, [0, 1], [20, 8], Extrapolation.CLAMP),
    backgroundColor: interpolateColor(
      Math.min(d.value, 1), [0, 1], ["#2563eb", "#d7dee7"]
    ),
  }));

  return <Animated.View style={[style, { height: 8, borderRadius: 4 }]} />;
}
