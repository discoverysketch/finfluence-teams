/* eslint-disable @typescript-eslint/no-explicit-any */
// Retry wrapper for Anthropic calls: 529 Overloaded is transient — back off and
// retry before surfacing anything to the rep. Also maps raw API errors to a
// human sentence for the UI.
export async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e: any) {
      last = e;
      // 429 is transient too — concurrent callers (the batch sweep runs four at
      // once) hit the rate limit routinely, and treating it as fatal threw away
      // work that would have succeeded a few seconds later.
      const rateLimited = e?.status === 429 || /rate.?limit/i.test(String(e?.message ?? e));
      const transient = rateLimited || (typeof e?.status === "number" && e.status >= 500) || /overloaded|api_error|internal server/i.test(String(e?.message ?? e));
      if (!transient || i === tries - 1) throw e;
      // Honour Retry-After when the API sends one; back off harder on 429.
      const hinted = Number(e?.headers?.["retry-after"] ?? e?.error?.retry_after);
      const waitMs = Number.isFinite(hinted) && hinted > 0
        ? Math.min(hinted * 1000, 60000)
        : (rateLimited ? 8000 : 3000) * (i + 1);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw last;
}

export function friendlyAiError(e: unknown): string {
  const raw = String((e as any)?.message ?? e);
  if (/overloaded|529/i.test(raw)) return "The AI service is busy right now — try again in a minute.";
  if (/api_error|internal server|"type":"error"/i.test(raw)) return "The AI service hit a temporary error — try again in a minute.";
  // The account-level spend cap. Distinct from a rate limit: waiting doesn't
  // help, an admin has to raise it, so say that instead of "try again".
  if (/usage limit|spend limit|credit balance|billing/i.test(raw)) {
    const when = raw.match(/regain access on (\d{4}-\d{2}-\d{2})/i)?.[1];
    return `AccountFluency's AI budget for this period has been used up${when ? ` — it resets on ${when}` : ""}. Ask your admin to raise the limit if you need it sooner.`;
  }
  // We abort research at 210s rather than let it hang into a gateway timeout.
  if (/timed out|timeout|aborted/i.test(raw)) return "That lookup took too long and was stopped. Try again — if it keeps timing out, the sources for this account are unusually slow.";
  if (/rate.?limit|429/i.test(raw)) return "Hit the AI rate limit — wait a moment and try again.";
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}
