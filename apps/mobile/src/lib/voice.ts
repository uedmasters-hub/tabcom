/**
 * Voice notes — press-and-hold recording in the composer.
 *
 * Kept deliberately small: AAC mono at a low bitrate, hard-capped at
 * MAX_VOICE_SECONDS, so a note stays well under the socket frame limit
 * and sends instantly on mobile data. Same philosophy as the video
 * policy: this is messaging, not archival audio.
 */
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { Alert } from "react-native";

export const MAX_VOICE_SECONDS = 120;
export const MAX_VOICE_BYTES = 2 * 1024 * 1024;

export const VOICE_PRESET = RecordingPresets.LOW_QUALITY;

export function useVoiceRecorder() {
  return useAudioRecorder(VOICE_PRESET);
}

export async function ensureMicPermission(): Promise<boolean> {
  const status = await AudioModule.requestRecordingPermissionsAsync();
  if (!status.granted) {
    Alert.alert("Microphone needed", "Allow microphone access to record voice notes.");
    return false;
  }
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  return true;
}

export interface VoiceResult {
  dataUrl: string;
  durationMs: number;
  fileSize: number;
}

export async function packageRecording(
  uri: string,
  durationMs: number
): Promise<VoiceResult | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    const size = info.exists && "size" in info ? ((info as { size?: number }).size ?? 0) : 0;
    if (size > MAX_VOICE_BYTES) {
      Alert.alert("Voice note too long", "Keep voice notes under about two minutes.");
      return null;
    }
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return {
      // MUST be audio/mp4, not audio/m4a. "audio/m4a" is not a
      // registered MIME type, so Chrome refuses to decode the data URL
      // and the extension's player silently fails at 0:00. expo-audio
      // records AAC-in-MP4, which audio/mp4 describes correctly.
      dataUrl: `data:audio/mp4;base64,${base64}`,
      durationMs,
      fileSize: size,
    };
  } catch {
    return null;
  }
}
