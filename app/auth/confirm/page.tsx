"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Finn from "@/components/Finn";

// Scanner-proof sign-in landing. Corporate mail security (Outlook SafeLinks,
// Proofpoint) auto-visits links in emails; the old direct Supabase verify URL
// was one-time-use, so the scanner consumed it before the human arrived —
// killing the code too (same token). This page holds the token_hash and only
// verifies on a REAL button click, which scanners never make.
export default function ConfirmPage() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [err, setErr] = useState("");

  async function complete() {
    setState("busy"); setErr("");
    const params = new URLSearchParams(window.location.search);
    const token_hash = params.get("token_hash") || "";
    const t = params.get("type") || "email";
    const type = (["email", "invite", "recovery", "magiclink", "signup"].includes(t) ? t : "email") as "email" | "invite" | "recovery" | "magiclink" | "signup";
    if (!token_hash) { setErr("This link is incomplete — request a fresh one from the sign-in page."); setState("error"); return; }
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (error) {
      setErr(/expired|invalid/i.test(error.message)
        ? "This link has expired or was already used — request a fresh one from the sign-in page."
        : error.message);
      setState("error");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="container" style={{ textAlign: "center" }}>
      <Finn className="bob" style={{ width: 110, height: 130, marginTop: 24 }} />
      <h1>Account<span style={{ color: "var(--red)" }}>Fluency</span></h1>
      <div className="card" style={{ marginTop: 16 }}>
        <p style={{ marginTop: 0, fontSize: 14.5 }}>One tap to finish signing in.</p>
        <button className="btn" style={{ width: "100%" }} disabled={state === "busy"} onClick={complete}>
          {state === "busy" ? "Signing you in…" : "Complete sign-in"}
        </button>
        {state === "error" && (
          <>
            <p style={{ color: "var(--red)", fontSize: 13.5, margin: "10px 0 0" }}>{err}</p>
            <a href="/login" style={{ display: "inline-block", marginTop: 10, fontSize: 13, fontWeight: 700, color: "var(--blue)" }}>← Back to sign-in</a>
          </>
        )}
      </div>
    </main>
  );
}
