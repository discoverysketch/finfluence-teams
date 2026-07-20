"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Finn from "@/components/Finn";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
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
          <p>Check your email for a magic link to sign in.</p>
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
          </form>
        )}
      </div>
    </main>
  );
}
