/**
 * Media capture & picking for chat attachments.
 *
 * VIDEO POLICY (messaging-optimised, not archival):
 *   - 720p HD only — never 4K. Lower bitrate = fast send, low data.
 *   - Hard cap MAX_VIDEO_BYTES (3 MB). Recording auto-stops at the
 *     duration ceiling, and anything still over the cap after capture
 *     is rejected with a clear message rather than silently failing
 *     at the socket layer.
 *   - MAX_VIDEO_SECONDS is derived from the cap at the expected 720p
 *     bitrate, so the recorder stops itself before it can overshoot.
 *
 * Everything is device-to-device: files become data URLs carried in
 * the message payload and are never stored on the Tabcom server.
 */
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as Location from "expo-location";
import * as VideoThumbnails from "expo-video-thumbnails";
import * as FileSystem from "expo-file-system/legacy";
import { Alert } from "react-native";

// Every send costs roughly 2.7x the file size in billed bandwidth
// (base64 adds ~33%, then it travels up to the relay and back down).
// A 3 MB video is therefore ~8 MB of transfer.
export const MAX_VIDEO_BYTES = 3 * 1024 * 1024; // 3 MB
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_FILE_BYTES = 3 * 1024 * 1024;  // 3 MB

/** ~1.2 Mbps at 720p ≈ 150 KB/s → 3 MB ≈ 20s. Round down for safety. */
export const MAX_VIDEO_SECONDS = 20;

export interface MediaResult {
  kind: "image" | "video" | "file";
  dataUrl: string;
  fileName?: string;
  fileSize: number;
  mimeType?: string;
  durationMs?: number;
  /** Video only: small JPEG poster frame so the bubble shows a real
   *  preview instead of a blank tile. Generated at send time and sent
   *  with the message, so the receiver needs no extra round trip. */
  thumbnailUrl?: string;
}

/** Grab a poster frame ~1s in. Small and heavily compressed — this
 *  rides along in the message payload, so it must stay tiny. */
async function videoPoster(uri: string): Promise<string | undefined> {
  try {
    const { uri: shot } = await VideoThumbnails.getThumbnailAsync(uri, {
      time: 1000,
      quality: 0.4,
    });
    return await toDataUrl(shot, "image/jpeg");
  } catch {
    return undefined;
  }
}

async function toDataUrl(uri: string, mimeType: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return `data:${mimeType};base64,${base64}`;
}

async function sizeOf(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && "size" in info ? ((info as { size?: number }).size ?? 0) : 0;
}

function tooBig(label: string, bytes: number, cap: number): boolean {
  if (bytes <= cap) return false;
  Alert.alert(
    `${label} too large`,
    `That ${label.toLowerCase()} is ${(bytes / 1024 / 1024).toFixed(1)} MB. The limit is ${(cap / 1024 / 1024).toFixed(0)} MB so messages stay fast on mobile data.`
  );
  return true;
}

/** Photo & Video Library. Images are compressed; videos are capped
 *  at 720p / MAX_VIDEO_SECONDS and re-checked against the byte cap. */
export async function pickFromLibrary(): Promise<MediaResult | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert("Permission needed", "Allow photo library access to attach media.");
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    quality: 0.55,
    videoMaxDuration: MAX_VIDEO_SECONDS,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.IFrame1280x720,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  const isVideo = asset.type === "video";
  const bytes = asset.fileSize ?? (await sizeOf(asset.uri));

  if (isVideo && tooBig("Video", bytes, MAX_VIDEO_BYTES)) return null;
  if (!isVideo && tooBig("Image", bytes, MAX_IMAGE_BYTES)) return null;

  const mime = asset.mimeType ?? (isVideo ? "video/mp4" : "image/jpeg");
  return {
    kind: isVideo ? "video" : "image",
    dataUrl: await toDataUrl(asset.uri, mime),
    fileName: asset.fileName ?? undefined,
    fileSize: bytes,
    mimeType: mime,
    durationMs: asset.duration ?? undefined,
    thumbnailUrl: isVideo ? await videoPoster(asset.uri) : undefined,
  };
}

/** Same constraints as the library path, but straight from the camera. */
export async function captureWithCamera(
  mode: "photo" | "video"
): Promise<MediaResult | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert("Permission needed", "Allow camera access to capture media.");
    return null;
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: mode === "video" ? ["videos"] : ["images"],
    quality: 0.55,
    // HD, never 4K — recording stops itself at the duration ceiling so
    // the file can't grow past the 5 MB cap.
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.IFrame1280x720,
    videoMaxDuration: MAX_VIDEO_SECONDS,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  const isVideo = mode === "video" || asset.type === "video";
  const bytes = asset.fileSize ?? (await sizeOf(asset.uri));

  if (isVideo && tooBig("Video", bytes, MAX_VIDEO_BYTES)) return null;
  if (!isVideo && tooBig("Image", bytes, MAX_IMAGE_BYTES)) return null;

  const mime = asset.mimeType ?? (isVideo ? "video/mp4" : "image/jpeg");
  return {
    kind: isVideo ? "video" : "image",
    dataUrl: await toDataUrl(asset.uri, mime),
    fileName: asset.fileName ?? undefined,
    fileSize: bytes,
    mimeType: mime,
    durationMs: asset.duration ?? undefined,
    thumbnailUrl: isVideo ? await videoPoster(asset.uri) : undefined,
  };
}

export async function pickDocument(): Promise<MediaResult | null> {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  const bytes = asset.size ?? (await sizeOf(asset.uri));
  if (tooBig("File", bytes, MAX_FILE_BYTES)) return null;

  const mime = asset.mimeType ?? "application/octet-stream";
  return {
    kind: "file",
    dataUrl: await toDataUrl(asset.uri, mime),
    fileName: asset.name,
    fileSize: bytes,
    mimeType: mime,
  };
}

export async function pickLocation(): Promise<{ latitude: number; longitude: number } | null> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) {
    Alert.alert("Permission needed", "Allow location access to share where you are.");
    return null;
  }
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
}
