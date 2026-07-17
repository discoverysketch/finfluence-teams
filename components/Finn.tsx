// Finn the finance-whiz wizard — v2. Gradient-shaded vector: bent-tip hat,
// gold spectacles, shaped beard, robe with a rising-chart embroidery, glowing
// orb staff. Same viewBox/API as v1 so all usages + the bob animation work.
export default function Finn({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={`finn ${className}`} style={style} viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fnz-hat" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#DA5A41" /><stop offset="1" stopColor="#B23A2E" />
        </linearGradient>
        <linearGradient id="fnz-brim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B93F2D" /><stop offset="1" stopColor="#8E2D20" />
        </linearGradient>
        <linearGradient id="fnz-robe" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#D4553F" /><stop offset="1" stopColor="#A33324" />
        </linearGradient>
        <linearGradient id="fnz-beard" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FBF8F1" /><stop offset="1" stopColor="#D8D0BF" />
        </linearGradient>
        <linearGradient id="fnz-skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FBDFC0" /><stop offset="1" stopColor="#F0C193" />
        </linearGradient>
        <linearGradient id="fnz-band" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#E3B354" /><stop offset="1" stopColor="#B27B1E" />
        </linearGradient>
        <radialGradient id="fnz-glow">
          <stop offset="0" stopColor="#F2CE7B" stopOpacity=".65" /><stop offset="1" stopColor="#F2CE7B" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="fnz-orb" cx=".38" cy=".32">
          <stop offset="0" stopColor="#FFFDF2" /><stop offset=".55" stopColor="#F0C562" /><stop offset="1" stopColor="#C8902E" />
        </radialGradient>
      </defs>

      {/* ground shadow */}
      <ellipse cx="60" cy="133" rx="31" ry="4.5" fill="#3A2A16" opacity=".12" />

      {/* staff + glowing orb */}
      <line x1="88" y1="129" x2="97" y2="64" stroke="#7A5230" strokeWidth="4" strokeLinecap="round" />
      <line x1="88.9" y1="122" x2="96" y2="70" stroke="#93683F" strokeWidth="1.4" strokeLinecap="round" opacity=".7" />
      <circle cx="98" cy="55" r="15" fill="url(#fnz-glow)" />
      <circle cx="98" cy="55" r="7" fill="url(#fnz-orb)" />
      <circle cx="95.6" cy="52.6" r="1.6" fill="#FFF9E8" opacity=".9" />
      {/* sparkles */}
      <path d="M110 34 l1 2.6 2.6 1 -2.6 1 -1 2.6 -1 -2.6 -2.6 -1 2.6 -1 Z" fill="#D9A83F" opacity=".8" />
      <path d="M86 40 l.7 1.9 1.9 .7 -1.9 .7 -.7 1.9 -.7 -1.9 -1.9 -.7 1.9 -.7 Z" fill="#D9A83F" opacity=".55" />
      <path d="M108 74 l.7 1.9 1.9 .7 -1.9 .7 -.7 1.9 -.7 -1.9 -1.9 -.7 1.9 -.7 Z" fill="#D9A83F" opacity=".5" />

      {/* robe */}
      <path d="M57 76 C46 76 41 84 39 94 C37 106 33 118 30 127 Q44 133 57 133 Q70 133 84 127 C81 118 77 106 75 94 C73 84 68 76 57 76 Z" fill="url(#fnz-robe)" />
      {/* robe folds */}
      <path d="M46 86 C44 100 42 114 39 126" stroke="#8E2D20" strokeWidth="1.6" fill="none" opacity=".45" strokeLinecap="round" />
      <path d="M68 86 C70 100 72 114 75 126" stroke="#8E2D20" strokeWidth="1.6" fill="none" opacity=".45" strokeLinecap="round" />
      {/* collar */}
      <path d="M49 77 L57 86 L65 77 Z" fill="#8E2D20" />
      {/* rising-chart embroidery (ends pointing up, as it should) */}
      <polyline points="40,116 47,109 53,112 59,106 64,100.5" fill="none" stroke="#E3B354" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity=".9" />
      <path d="M66.5 97.5 L65.9 102.2 L61.9 98.8 Z" fill="#E3B354" opacity=".9" />

      {/* sleeve + hand on staff */}
      <path d="M71 83 C80 84 88 92 92 99 L86 107 C81 97 75 91 67 89 Z" fill="#B23A2E" />
      <circle cx="90.5" cy="102" r="4.4" fill="url(#fnz-skin)" />

      {/* head */}
      <circle cx="57" cy="50" r="20" fill="url(#fnz-skin)" />

      {/* beard */}
      <path d="M39 53 C39 73 46 85 57 88 C68 85 75 73 75 53 C70 61 64 64 57 64 C50 64 44 61 39 53 Z" fill="url(#fnz-beard)" />
      <path d="M57 66 C56 74 56 80 57 86" stroke="#CFC7B4" strokeWidth="1.2" fill="none" opacity=".8" />
      {/* mustache */}
      <path d="M46 57 Q57 67 68 57 Q62 63 57 62 Q52 63 46 57 Z" fill="#F3EFE6" />

      {/* nose */}
      <path d="M57 50 Q59.5 55 57.5 57.5" stroke="#DFA97C" strokeWidth="1.8" fill="none" strokeLinecap="round" />

      {/* gold spectacles + calm eyes */}
      <circle cx="48.5" cy="48" r="6.4" fill="rgba(255,255,255,.35)" stroke="#C8902E" strokeWidth="1.9" />
      <circle cx="65.5" cy="48" r="6.4" fill="rgba(255,255,255,.35)" stroke="#C8902E" strokeWidth="1.9" />
      <line x1="54.9" y1="47.4" x2="59.1" y2="47.4" stroke="#C8902E" strokeWidth="1.9" strokeLinecap="round" />
      <line x1="42.1" y1="47" x2="38.5" y2="45.6" stroke="#C8902E" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="71.9" y1="47" x2="75.5" y2="45.6" stroke="#C8902E" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="48.5" cy="48.6" r="2.1" fill="#1D1F2B" />
      <circle cx="65.5" cy="48.6" r="2.1" fill="#1D1F2B" />
      <circle cx="49.3" cy="47.8" r=".8" fill="#fff" />
      <circle cx="66.3" cy="47.8" r=".8" fill="#fff" />
      {/* brows */}
      <path d="M43 40.5 Q48.5 37.5 53 40" stroke="#E4DCCB" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M61 40 Q65.5 37.5 71 40.5" stroke="#E4DCCB" strokeWidth="2.4" fill="none" strokeLinecap="round" />

      {/* hat: brim, bent cone, band, charm */}
      <ellipse cx="57" cy="31" rx="27" ry="5.6" fill="url(#fnz-brim)" />
      <path d="M35 30 C40 16 50 8 61 6 C74 3.5 84 4.5 93 0 C89 10 80 12 75 15 C77 20 79 25 79.5 30 Q57 36 35 30 Z" fill="url(#fnz-hat)" />
      <path d="M40 25 C46 13 55 8.5 62 7.5" stroke="#F0A08C" strokeWidth="1.6" fill="none" opacity=".5" strokeLinecap="round" />
      <path d="M36.5 29.5 Q57 34.5 79 29.5 L79.5 25.5 Q57 30 37.5 25.5 Z" fill="url(#fnz-band)" />
      <path d="M57 24.5 l1 2.4 2.4 1 -2.4 1 -1 2.4 -1 -2.4 -2.4 -1 2.4 -1 Z" fill="#FBF3DC" opacity=".95" />
    </svg>
  );
}
