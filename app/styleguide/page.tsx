import Finn from "@/components/Finn";

// Public, data-free design reference — every shared style in one place so visual
// changes can be reviewed without signing in. Static markup only.
export default function Styleguide() {
  return (
    <>
      <header className="appbar">
        <Finn />
        <div className="lvl">Lv <b>4</b></div>
        <div className="xpwrap"><div className="xpbar" style={{ width: "60%" }} /></div>
        <button className="mutebtn">🔊</button>
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

        <h2>Buttons</h2>
        <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn">Primary</button>
          <button className="btn" style={{ background: "var(--teal)" }}>Teal</button>
          <button className="btn" style={{ background: "var(--blue)" }}>Blue</button>
          <button className="btn" style={{ background: "var(--charcoal)" }}>Charcoal</button>
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
        <a className="on" href="#"><span className="ni">🗺️</span>Path</a>
        <a href="#"><span className="ni">🎯</span>Challenge</a>
        <a href="#"><span className="ni">🏢</span>Accounts</a>
        <a href="#"><span className="ni">👤</span>Me</a>
      </nav>
    </>
  );
}
