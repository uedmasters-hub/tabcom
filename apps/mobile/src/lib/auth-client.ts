import { createAuthClient } from "@tabcom/shared";
import { REALTIME_URL } from "./config";
import { getDeviceId, getDeviceInfo } from "./device-id";

export const auth = createAuthClient({
  baseUrl: REALTIME_URL,
  getDeviceId,
  getDeviceInfo,
});
