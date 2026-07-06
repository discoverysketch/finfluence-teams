import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

// Server-only web-push sender. Dead subscriptions (410/404) are pruned.
/* eslint-disable @typescript-eslint/no-explicit-any */
let configured = false;
function ensureConfigured() {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:dan.wain1@gmail.com", pub, priv);
  configured = true;
  return true;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

// Send to every subscription of the given users. Returns delivered count.
export async function pushToUsers(userIds: string[], payload: PushPayload): Promise<number> {
  if (!userIds.length || !ensureConfigured()) return 0;
  const admin = createAdminClient();
  const { data: subs } = await admin.from("push_subscriptions")
    .select("id, endpoint, p256dh, auth").in("user_id", userIds);
  let sent = 0;
  await Promise.all((subs ?? []).map(async (s: any) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (e: any) {
      if (e?.statusCode === 410 || e?.statusCode === 404) {
        await admin.from("push_subscriptions").delete().eq("id", s.id); // expired
      }
    }
  }));
  return sent;
}
