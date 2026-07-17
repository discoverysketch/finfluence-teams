"use client";
import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { soundOn, setSound } from "@/lib/sfx";

export default function MuteButton() {
  const [on, setOn] = useState(true);
  useEffect(() => { setOn(soundOn()); }, []);
  return (
    <button
      className="mutebtn"
      aria-label="Toggle sound"
      onClick={() => { const next = !on; setOn(next); setSound(next); }}
    >
      {on ? <Volume2 size={16} strokeWidth={2} /> : <VolumeX size={16} strokeWidth={2} />}
    </button>
  );
}
