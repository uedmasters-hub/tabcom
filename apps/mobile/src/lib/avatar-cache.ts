/**
 * Local profile-photo cache — data URLs from the roster are written to
 * document storage so avatars survive relaunch without re-downloading
 * and stay consistent across Chat / Discover / Contacts.
 */
import * as FileSystem from "expo-file-system/legacy";

const AVATAR_DIR = `${FileSystem.documentDirectory}tabcom-avatars/`;

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(AVATAR_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(AVATAR_DIR, { intermediates: true });
  }
}

/**
 * Persist a contact photo. Returns a file:// URI when the input is a
 * data URL; passes through existing file/http URIs unchanged.
 */
export async function cacheContactPhoto(
  username: string,
  photo: string | undefined | null
): Promise<string | undefined> {
  if (!photo) return undefined;
  if (photo.startsWith("file://") || photo.startsWith("http://") || photo.startsWith("https://")) {
    return photo;
  }
  if (!photo.startsWith("data:image/")) return photo;

  try {
    await ensureDir();
    const ext = photo.includes("image/png") ? "png" : "jpg";
    const fileUri = `${AVATAR_DIR}${username}.${ext}`;
    const base64 = photo.includes(",") ? photo.split(",")[1]! : photo;
    await FileSystem.writeAsStringAsync(fileUri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return fileUri;
  } catch (err) {
    if (__DEV__) console.warn("[tabcom-avatar] cache failed:", err);
    return photo;
  }
}

export async function clearAvatarCache(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(AVATAR_DIR);
    if (info.exists) {
      await FileSystem.deleteAsync(AVATAR_DIR, { idempotent: true });
    }
  } catch {
    /* best effort */
  }
}

export async function removeCachedAvatar(username: string): Promise<void> {
  for (const ext of ["jpg", "png"]) {
    try {
      const fileUri = `${AVATAR_DIR}${username}.${ext}`;
      const info = await FileSystem.getInfoAsync(fileUri);
      if (info.exists) await FileSystem.deleteAsync(fileUri, { idempotent: true });
    } catch {
      /* ignore */
    }
  }
}
