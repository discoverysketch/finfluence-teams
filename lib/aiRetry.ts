/* eslint-disable @typescript-eslint/no-explicit-any */
// Retry wrapper for Anthropic calls: 529 Overloaded is transient — back off and
// retry before surfacing anything to the rep. Also maps raw API errors to a
// human sentence for the UI.
export async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e: any) {
      last = e;
      const overloaded = e?.status === 529 || /overloaded/i.test(String(e?.message ?? e));
      if (!overloaded || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw last;
}

export function friendlyAiError(e: unknown): string {
  const raw = String((e as any)?.message ?? e);
  if (/overloaded|529/i.test(raw)) return "The AI service is busy right now — try again in a minute.";
  if (/rate.?limit|429/i.test(raw)) return "Hit the AI rate limit — wait a moment and try again.";
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}
