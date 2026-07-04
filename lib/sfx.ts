// Web Audio sound effects + haptics, ported from the single-file app. Client-only.
/* eslint-disable @typescript-eslint/no-explicit-any */
const SND_KEY = "finfluency_sound";
let actx: AudioContext | null | undefined;

export function soundOn(): boolean {
  if (typeof window === "undefined") return true;
  try { return localStorage.getItem(SND_KEY) !== "0"; } catch { return true; }
}
export function setSound(on: boolean) {
  try { localStorage.setItem(SND_KEY, on ? "1" : "0"); } catch {}
  if (on) SFX.correct();
}
export function unlockAudio() { audio(); }

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (actx === undefined) {
    try { actx = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch { actx = null; }
  }
  if (actx && actx.state === "suspended") actx.resume();
  return actx ?? null;
}
function blip(freqs: number[], dur = 0.12, type: OscillatorType = "sine", vol = 0.18, gap = 0) {
  if (!soundOn()) return;
  const ctx = audio(); if (!ctx) return;
  const t0 = ctx.currentTime;
  freqs.forEach((f, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f;
    const st = t0 + i * (dur + gap);
    g.gain.setValueAtTime(0.0001, st);
    g.gain.linearRampToValueAtTime(vol, st + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
    o.connect(g).connect(ctx.destination);
    o.start(st); o.stop(st + dur + 0.03);
  });
}
function buzz(p: number | number[]) { if (!soundOn()) return; try { (navigator as any).vibrate?.(p); } catch {} }

export const SFX = {
  correct: () => { blip([659, 880, 1175], 0.11, "triangle", 0.2, 0.012); buzz(18); },
  level: () => { blip([523, 659, 784, 1047], 0.14, "triangle", 0.22, 0.02); buzz([18, 40, 18, 40]); },
  wrong: () => { blip([330, 247], 0.16, "sine", 0.14, 0); buzz(35); },
  flip: () => blip([520], 0.045, "sine", 0.06),
  win: () => { blip([523, 659, 784, 1047, 1319], 0.13, "triangle", 0.2, 0.015); buzz([20, 40, 20, 40]); },
};

export function sparkle(x: number, y: number, count = 6) {
  if (typeof document === "undefined") return;
  const glyphs = ["✨", "⭐", "💫", "🪙"];
  for (let i = 0; i < count; i++) {
    const s = document.createElement("div");
    s.className = "spark";
    s.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
    s.style.left = x + (Math.random() - 0.5) * 60 + "px";
    s.style.top = y + (Math.random() - 0.5) * 30 + "px";
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1100);
  }
}
