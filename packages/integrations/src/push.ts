/**
 * Push notifications to the installer app through Expo's push service
 * (which forwards to Apple and Google). An optional access token makes Expo
 * accept only GoInstall's requests once "enhanced security" is switched on.
 */

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  /** Where a tap takes them in the app. */
  data?: Record<string, string>;
}

export interface PushResult {
  /** Tokens Expo says belong to no device any more: stop sending to them. */
  invalidTokens: string[];
  sent: number;
  errors: string[];
}

export interface PushSender {
  readonly name: string;
  send(messages: PushMessage[]): Promise<PushResult>;
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export function createExpoPush({ accessToken, fetch: fetchImpl = fetch }: { accessToken?: string; fetch?: typeof fetch } = {}): PushSender {
  return {
    name: "expo",
    async send(messages) {
      const result: PushResult = { invalidTokens: [], sent: 0, errors: [] };
      // Expo takes up to 100 messages a request.
      for (let i = 0; i < messages.length; i += 100) {
        const batch = messages.slice(i, i + 100);
        const res = await fetchImpl(EXPO_PUSH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
          body: JSON.stringify(batch.map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data ?? {}, sound: "default", priority: "high", channelId: "default" }))),
        });
        const body = (await res.json().catch(() => ({}))) as { data?: { status: "ok" | "error"; message?: string; details?: { error?: string } }[]; errors?: { message: string }[] };
        if (!res.ok || !body.data) {
          result.errors.push(body.errors?.[0]?.message ?? `Expo push failed (${res.status})`);
          continue;
        }
        body.data.forEach((t, j) => {
          if (t.status === "ok") result.sent++;
          else if (t.details?.error === "DeviceNotRegistered") result.invalidTokens.push(batch[j]!.to);
          else result.errors.push(t.message ?? "Push failed");
        });
      }
      return result;
    },
  };
}

/** Records pushes instead of sending them (development and tests). */
export function createRecordingPush(record: (m: PushMessage & { at: string }) => Promise<void> | void): PushSender {
  return {
    name: "recording",
    async send(messages) {
      for (const m of messages) await record({ ...m, at: new Date().toISOString() });
      return { invalidTokens: [], sent: messages.length, errors: [] };
    },
  };
}
