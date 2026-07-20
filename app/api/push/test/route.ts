import { createClient } from "@/lib/supabase/server";
import { pushToUsers } from "@/lib/push";
import { NextResponse } from "next/server";

// Sends a test notification to the caller's own devices.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.VAPID_PRIVATE_KEY) return NextResponse.json({ error: "Push keys not configured on the server (VAPID env vars)." }, { status: 500 });

  const sent = await pushToUsers([user.id], {
    title: "AccountFluency 🔔",
    body: "Notifications are working — you'll get a ping when your accounts file.",
    url: "/challenge/pulse",
    tag: "test",
  });
  if (!sent) return NextResponse.json({ error: "No active subscriptions for this account — enable notifications first." }, { status: 404 });
  return NextResponse.json({ sent });
}
