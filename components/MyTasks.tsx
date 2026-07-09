"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// Open next steps across all accounts (My Day). Check-off updates in place.
export type Task = { id: string; body: string; due_at: string | null; accountId: string; accountName: string };
const fmtDue = (s: string) => new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function MyTasks({ initial }: { initial: Task[] }) {
  const supabase = createClient();
  const [tasks, setTasks] = useState(initial);
  if (!tasks.length) return null;

  async function done(id: string) {
    setTasks((ts) => ts.filter((t) => t.id !== id));
    await supabase.from("activities").update({ done: true }).eq("id", id);
  }

  return (
    <div style={{ textAlign: "left" }}>
      <div className="daysec">✅ Next steps · {tasks.length}</div>
      {tasks.map((t) => {
        const overdue = t.due_at && new Date(t.due_at) < new Date();
        return (
          <div key={t.id} className="card" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, padding: "10px 12px" }}>
            <input type="checkbox" checked={false} onChange={() => done(t.id)} style={{ width: 18, height: 18 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14 }}>{t.body}</div>
              <Link href={`/territory/account/${t.accountId}`} style={{ fontSize: 12, color: "var(--blue)", fontWeight: 600 }}>{t.accountName}</Link>
            </div>
            {t.due_at && <span style={{ fontSize: 12, fontWeight: 700, color: overdue ? "var(--red)" : "var(--ink2)" }}>{overdue ? "⚠ " : ""}{fmtDue(t.due_at)}</span>}
          </div>
        );
      })}
    </div>
  );
}
