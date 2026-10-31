import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { API_URL } from "./config";

/**
 * Push notifications on real phones (not the web build or simulators). The
 * Expo project id comes from EAS (app config `extra.eas.projectId`); until
 * the app is linked to an Expo account there is none, and push stays off.
 */
const supported = Platform.OS === "ios" || Platform.OS === "android";
let registered: string | null = null;

if (supported) {
  // Show notifications while the app is open too.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export type PushStatus = "registered" | "denied" | "unavailable" | "not_linked" | "error";

export async function registerForPush(authToken: string): Promise<PushStatus> {
  if (!supported || !Device.isDevice) return "unavailable";
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return "not_linked";
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", { name: "Jobs and messages", importance: Notifications.AndroidImportance.HIGH });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return "denied";
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const res = await fetch(`${API_URL}/api/app/push-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ token, platform: Platform.OS }),
    });
    if (!res.ok) return "error";
    registered = token;
    return "registered";
  } catch {
    return "error";
  }
}

/** Signing out: this phone stops getting that person's notifications. */
export async function unregisterPush(authToken: string | null): Promise<void> {
  if (!registered || !authToken) return;
  const token = registered;
  registered = null;
  await fetch(`${API_URL}/api/app/push-token`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  }).catch(() => null);
}

/** Taps on a notification: what it was about (the server sends the event and project). */
export function onNotificationTap(handle: (data: { event?: string; projectId?: string }) => void): () => void {
  if (!supported) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((r) => handle((r.notification.request.content.data ?? {}) as { event?: string; projectId?: string }));
  // A tap that opened the app from closed.
  void Notifications.getLastNotificationResponseAsync().then((r) => r && handle((r.notification.request.content.data ?? {}) as { event?: string; projectId?: string }));
  return () => sub.remove();
}
