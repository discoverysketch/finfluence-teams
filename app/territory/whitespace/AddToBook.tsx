"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function AddToBook({ listId, entityId, userId }: { listId: string; entityId: string; userId?: string }) {
  const supabase = createClient();
  const [state, setState] = useState<"idle" | "busy" | "added" | "err">("idle");

  async function add() {
    setState("busy");
    const { data, error } = await supabase.from("accounts").insert({ list_id: listId, entity_id: entityId, owner: userId ?? null }).select("id").single();
    // unique index (list_id, entity_id) => duplicate insert errors are fine to treat as added
    setState(error && !error.message.includes("duplicate") ? "err" : "added");
    // Kick background people research; results stage on the account for Hub review.
    if (data?.id) {
      fetch("/api/research-people", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: data.id }), keepalive: true,
      }).catch(() => {});
    }
  }

  if (state === "added") return <span style={{ fontSize: 12, fontWeight: 700, color: "#1B7A47" }}>✓ In book</span>;
  return (
    <button className="mini" onClick={add} disabled={state === "busy"}
      style={{ border: "1px solid var(--border)", background: "#fff", borderRadius: 6, padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: state === "err" ? "var(--red)" : "var(--ink2)" }}>
      {state === "busy" ? "…" : state === "err" ? "Failed — retry" : "+ Add"}
    </button>
  );
}
