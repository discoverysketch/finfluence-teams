import Finn from "@/components/Finn";
import { Map, Target, Building2, UserRound, Trophy, Zap, BookOpenCheck, Swords, Briefcase, Telescope, Volume2 } from "lucide-react";

// Public, data-free design reference — every shared style in one place so visual
// changes can be reviewed without signing in. Static markup only.
export default function Styleguide() {
  return (
    <>
      <header className="appbar">
        <Finn />
        <div className="lvl">Lv <b>4</b></div>
        <div className="xpwrap"><div className="xpbar" style={{ width: "60%" }} /></div>
        <button className="mutebtn"><Volume2 size={16} strokeWidth={2} /></button>
      </header>
      <main className="container">
        <h1>Style<span style={{ color: "var(--red)" }}>guide</span></h1>
        <p style={{ color: "var(--ink2)", fontSize: 13, marginTop: 0 }}>Static reference — no data behind this page.</p>

        <h2>Cards</h2>
        <div className="card" style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>A standard card</div>
          <div style={{ fontSize: 12, color: "var(--ink2)" }}>With supporting text and a <a href="#">link</a>.</div>
        </div>
        <a href="#" style={{ color: "inherit" }}>
          <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 24 }}>🏢</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>A linked card (hover me)</div>
              <div style={{ height: 6, background: "var(--cream2)", borderRadius: 4, marginTop: 6, overflow: "hidden" }}>
                <div style={{ width: "62%", height: "100%", background: "var(--gold)" }} />
              </div>
            </div>
            <div style={{ fontSize: 18 }}>›</div>
          </div>
        </a>

        <h2>Segmented switcher</h2>
        <div className="seg" style={{ marginBottom: 4 }}>
          <a className="on" href="#">Book</a>
          <a href="#">Board</a>
          <a href="#">Whitespace</a>
        </div>

        <h2>Stat tiles</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 4 }}>
          <div className="card stat">
            <span className="statico" style={{ background: "rgba(200,144,46,.14)", color: "var(--gold)" }}><Trophy size={17} strokeWidth={2} /></span>
            <div><div className="statn">#2</div><div className="statl">league rank</div></div>
          </div>
          <div className="card stat">
            <span className="statico" style={{ background: "rgba(27,122,71,.11)", color: "var(--green)" }}><BookOpenCheck size={17} strokeWidth={2} /></span>
            <div><div className="statn">47</div><div className="statl">cards mastered</div></div>
          </div>
        </div>

        <h2>Buttons</h2>
        <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-i"><Swords size={15} strokeWidth={2.2} /> Primary</button>
          <button className="btn btn-i" style={{ background: "var(--teal)" }}><Zap size={15} strokeWidth={2.2} /> Teal</button>
          <button className="btn btn-i" style={{ background: "var(--blue)" }}><Briefcase size={15} strokeWidth={2.2} /> Blue</button>
          <button className="btn btn-i" style={{ background: "var(--charcoal)" }}><Telescope size={15} strokeWidth={2.2} /> Charcoal</button>
          <button className="btn" disabled>Disabled</button>
        </p>

        <h2>Inputs</h2>
        <div className="card">
          <input placeholder="Text input — focus me" style={{ marginBottom: 8 }} />
          <select style={{ marginBottom: 8 }}><option>Select option</option></select>
          <textarea rows={2} placeholder="Textarea" />
        </div>

        <h2>Chips &amp; badges</h2>
        <p style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ background: "#1B7A47", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 6px" }}>Tier A</span>
          <span style={{ background: "var(--gold)", color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "3px 9px" }}>Advanced</span>
          <span style={{ background: "#EEF4FB", color: "var(--blue)", borderRadius: 4, padding: "1px 7px", fontWeight: 700, fontSize: 11 }}>discovery</span>
          <span style={{ background: "#1B7A47", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 7px" }}>Champion</span>
        </p>
      </main>
      <nav className="nav">
        <a className="on" href="#"><span className="nico"><Map size={20} strokeWidth={1.9} /></span>Path</a>
        <a href="#"><span className="nico"><Target size={20} strokeWidth={1.9} /></span>Challenge</a>
        <a href="#"><span className="nico"><Building2 size={20} strokeWidth={1.9} /></span>Accounts</a>
        <a href="#"><span className="nico"><UserRound size={20} strokeWidth={1.9} /></span>Me</a>
      </nav>
    </>
  );
}
