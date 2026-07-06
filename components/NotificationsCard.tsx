"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Enable/disable Earnings Pulse push notifications (Me page).
function b64ToU8(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function NotificationsCard({ userId }: { userId: string }) {
  const supabase = createClient();
  const [state, setState] = useState<"unsupported" | "off" | "on" | "denied" | "busy">("busy");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { setState("unsupported"); return; }
      if (Notification.permission === "denied") { setState("denied"); return; }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? "on" : "off");
      } catch { setState("off"); }
    })();
  }, []);

  async function enable() {
    setState("busy"); setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "denied" : "off"); return; }
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) { setMsg("Push key not configured on the server."); setState("off"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const { error } = await supabase.from("push_subscriptions").upsert(
        { user_id: userId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
        { onConflict: "endpoint" }
      );
      if (error) { setMsg(error.message); setState("off"); return; }
      setState("on");
    } catch { setMsg("Couldn't enable notifications."); setState("off"); }
  }

  async function disable() {
    setState("busy"); setMsg("");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } catch { setState("off"); }
  }

  async function test() {
    setMsg("Sending…");
    try {
      const r = await fetch("/api/push/test", { method: "POST" });
      const j = await r.json();
      setMsg(r.ok ? `Sent to ${j.sent} device${j.sent === 1 ? "" : "s"} — check your notifications.` : j.error || "Failed.");
    } catch { setMsg("Failed to send."); }
  }

  if (state === "unsupported") return null;

  return (
    <div className="card" style={{ marginTop: 14, textAlign: "left" }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".6px", color: "var(--muted)", marginBottom: 6 }}>🔔 Earnings Pulse alerts</div>
      <p style={{ fontSize: 13, color: "var(--ink2)", margin: "0 0 10px" }}>
        Get a ping when one of your accounts files a new 10-K/10-Q — then take a 5-question pulse on the fresh numbers.
      </p>
      {state === "denied" && <p style={{ fontSize: 12.5, color: "var(--red)", margin: 0 }}>Notifications are blocked for this site — enable them in your browser settings, then reload.</p>}
      {state === "off" && <button className="btn" onClick={enable}>Enable notifications</button>}
      {state === "busy" && <button className="btn" disabled>Working…</button>}
      {state === "on" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" style={{ background: "var(--charcoal)" }} onClick={test}>Send a test</button>
          <button className="btn" style={{ background: "#fff", color: "var(--ink2)", border: "1px solid var(--border)" }} onClick={disable}>Turn off</button>
        </div>
      )}
      {msg && <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "8px 0 0" }}>{msg}</p>}
    </div>
  );
}
