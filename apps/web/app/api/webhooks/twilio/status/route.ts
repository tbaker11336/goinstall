import { withService } from "@goinstall/db";
import { db } from "@/lib/db";
import { twilioParams } from "@/lib/twilio-webhooks";

const STATUS: Record<string, string> = { delivered: "delivered", undelivered: "failed", failed: "failed", sent: "sent" };

/** Delivery updates for texts GoInstall sent. */
export async function POST(request: Request) {
  const p = await twilioParams(request, "/api/webhooks/twilio/status");
  if (!p) return new Response("Invalid signature", { status: 403 });
  const status = STATUS[p.MessageStatus ?? ""];
  if (status && p.MessageSid) {
    await withService(db(), (tx) =>
      tx
        .updateTable("messages")
        .set({ delivery_status: status, ...(status === "failed" ? { delivery_error: p.ErrorCode ? `Twilio error ${p.ErrorCode}` : "Not delivered" } : {}) })
        .where("provider_message_id", "=", p.MessageSid!)
        .where("channel", "=", "sms")
        .execute(),
    );
  }
  return new Response(null, { status: 204 });
}
