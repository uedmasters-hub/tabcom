import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";

/**
 * Voice note playback.
 *
 * ROOT CAUSE of the "resets to 00:00" bug: messages carry audio as a
 * `data:` URL, and Android's native media player cannot open those. The
 * player would fail to load, report duration 0, and snap back to zero.
 * So we materialise the base64 into a real cache file once and play
 * from that file URI instead.
 */
export function VoiceBubble({
  messageId,
  dataUrl,
  durationMs,
  mine,
}: {
  messageId: string;
  dataUrl?: string;
  durationMs?: number;
  mine: boolean;
}) {
  const [fileUri, setFileUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!dataUrl) return;
      try {
        const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
        if (!base64) return;
        const path = `${FileSystem.cacheDirectory}voice-${messageId}.m4a`;
        const info = await FileSystem.getInfoAsync(path);
        if (!info.exists) {
          await FileSystem.writeAsStringAsync(path, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
        }
        if (!cancelled) setFileUri(path);
      } catch {
        /* leave unplayable — the bubble still shows the duration */
      }
    })();
    return () => { cancelled = true; };
  }, [dataUrl, messageId]);

  const player = useAudioPlayer(fileUri ? { uri: fileUri } : null);
  const status = useAudioPlayerStatus(player);

  const total = status?.duration && status.duration > 0
    ? status.duration
    : (durationMs ?? 0) / 1000;
  const elapsed = status?.currentTime ?? 0;
  const pct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;
  const playing = !!status?.playing;

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  const toggle = async () => {
    if (!fileUri) return;
    await setAudioModeAsync({ playsInSilentMode: true });
    if (playing) {
      player.pause();
      return;
    }
    // Finished tracks must be rewound explicitly or play() is a no-op.
    if (total > 0 && elapsed >= total - 0.15) await player.seekTo(0);
    player.play();
  };

  const tint = mine ? "#ffffff" : "#2563eb";
  const track = mine ? "rgba(255,255,255,0.28)" : "#dbeafe";
  const label = mine ? "text-slate-300" : "text-muted";

  return (
    <View className="flex-row items-center px-3.5 py-3" style={{ width: 210 }}>
      <Pressable
        onPress={toggle}
        disabled={!fileUri}
        hitSlop={8}
        className="mr-3 active:opacity-60"
      >
        <View
          className="w-10 h-10 rounded-full items-center justify-center"
          style={{ backgroundColor: mine ? "rgba(255,255,255,0.18)" : "#eff6ff" }}
        >
          <Ionicons
            name={playing ? "pause" : "play"}
            size={19}
            color={tint}
            style={{ marginLeft: playing ? 0 : 2 }}
          />
        </View>
      </Pressable>

      <View className="flex-1">
        <View className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: track }}>
          <View style={{ width: `${pct}%`, backgroundColor: tint }} className="h-full rounded-full" />
        </View>
        <Text className={`${label} text-[12px] mt-1.5`}>
          {playing || elapsed > 0 ? fmt(elapsed) : fmt(total)}
        </Text>
      </View>
    </View>
  );
}
