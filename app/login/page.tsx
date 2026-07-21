"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Finn from "@/components/Finn";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    // Invite-only: never create a user here — magic links only go to emails an
    // admin has already added via Admin -> Team.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback`, shouldCreateUser: false },
    });
    setLoading(false);
    if (error) {
      setError(/not allowed|not found|signups/i.test(error.message)
        ? "AccountFluency is invite-only — this email isn't on a team yet. Ask your team admin for an invite."
        : error.message);
    } else setSent(true);
  }

  // The same email carries a one-time code — handy when the email is on a
  // different device than this browser (phone inbox, laptop sign-in).
  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    const token = code.trim();
    if (token.length < 6) return;
    setVerifying(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    setVerifying(false);
    if (error) {
      setError(/expired|invalid/i.test(error.message)
        ? "That code didn't work — only the newest code is valid, and codes expire. Check for a newer email or request a fresh one."
        : error.message);
    } else {
      router.replace("/");
      router.refresh();
    }
  }

  return (
    <main className="container" style={{ textAlign: "center" }}>
      <Finn className="bob" style={{ width: 110, height: 130, marginTop: 24 }} />
      <h1>
        Account<span style={{ color: "var(--red)" }}>Fluency</span>
      </h1>
      <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: -4 }}>Research &amp; role play for energy and water sellers.</p>
      <div className="card" style={{ marginTop: 16 }}>
        {sent ? (
          <form onSubmit={verifyCode}>
            <p style={{ marginTop: 0 }}>Check your email — click the sign-in link, <b>or</b> enter the code from it here:</p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="12345678"
              style={{ marginBottom: 12, textAlign: "center", fontSize: 22, letterSpacing: "5px", fontWeight: 700 }}
            />
            <button className="btn" disabled={verifying || code.trim().length < 6} style={{ width: "100%" }}>
              {verifying ? "Checking…" : "Sign in with code"}
            </button>
            {error && <p style={{ color: "var(--red)", marginTop: 10 }}>{error}</p>}
            <button type="button" onClick={() => { setSent(false); setCode(""); setError(null); }}
              style={{ background: "none", border: "none", color: "var(--ink2)", fontSize: 12.5, marginTop: 12, cursor: "pointer", textDecoration: "underline" }}>
              Use a different email
            </button>
          </form>
        ) : (
          <form onSubmit={sendMagicLink}>
            <label style={{ fontWeight: 700, fontSize: 13 }}>Work email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              style={{ marginTop: 6, marginBottom: 12 }}
            />
            <button className="btn" disabled={loading} style={{ width: "100%" }}>
              {loading ? "Sending…" : "Send magic link"}
            </button>
            {error && <p style={{ color: "var(--red)", marginTop: 10 }}>{error}</p>}
            <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "10px 0 0" }}>Invite-only — sign-in links are sent to team members added by an admin.</p>
          </form>
        )}
      </div>
    </main>
  );
}
