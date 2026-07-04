// Finn the finance-whiz wizard — ported from the original single-file app.
export default function Finn({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={`finn ${className}`} style={style} viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
      <line x1="84" y1="126" x2="99" y2="58" stroke="#8A5A2A" strokeWidth="4" strokeLinecap="round" />
      <circle cx="99" cy="54" r="8" fill="#C8902E" opacity=".35" />
      <text x="99" y="59" fontSize="15" fill="#C8902E" textAnchor="middle">★</text>
      <path d="M45 78 L75 78 L86 122 L34 122 Z" fill="#C74634" />
      <path d="M45 78 L60 92 L75 78 Z" fill="#A63A2B" />
      <text x="46" y="106" fontSize="12" fill="#C8902E" fontWeight="bold">?</text>
      <text x="64" y="112" fontSize="12" fill="#F3EEE6" fontWeight="bold">?</text>
      <text x="54" y="119" fontSize="11" fill="#1D1F2B" fontWeight="bold">?</text>
      <text x="69" y="99" fontSize="11" fill="#C8902E">★</text>
      <circle cx="60" cy="52" r="22" fill="#FAD9B8" />
      <path d="M48 58 Q49 81 60 85 Q71 81 72 58 Q66 70 60 70 Q54 70 48 58 Z" fill="#ECE6DB" stroke="#D8CFBE" strokeWidth="1" />
      <circle cx="51" cy="49" r="8" fill="#fff" stroke="#1D1F2B" strokeWidth="2.5" />
      <circle cx="69" cy="49" r="8" fill="#fff" stroke="#1D1F2B" strokeWidth="2.5" />
      <line x1="59" y1="49" x2="61" y2="49" stroke="#1D1F2B" strokeWidth="2.5" />
      <circle cx="51" cy="49" r="3" fill="#1D1F2B" />
      <circle cx="69" cy="49" r="3" fill="#1D1F2B" />
      <circle cx="52.3" cy="47.7" r="1" fill="#fff" />
      <circle cx="70.3" cy="47.7" r="1" fill="#fff" />
      <path d="M53 59 q7 5 14 0" stroke="#B5654A" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <ellipse cx="60" cy="33" rx="30" ry="6" fill="#A63A2B" />
      <polygon points="41,33 64,3 83,33" fill="#C74634" />
      <polygon points="44,33 80,33 79,26 45,26" fill="#C8902E" />
      <text x="57" y="20" fontSize="12" fill="#C8902E">★</text>
      <text x="58" y="33" fontSize="9" fill="#1D1F2B" fontWeight="bold">?</text>
    </svg>
  );
}
