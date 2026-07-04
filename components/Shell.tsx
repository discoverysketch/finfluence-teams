import Link from "next/link";
import Finn from "./Finn";

type Tab = "home" | "path" | "challenge" | "content";

export default function Shell({
  active, isAdmin, children,
}: { active: Tab; isAdmin?: boolean; children: React.ReactNode }) {
  const cls = (t: Tab) => (active === t ? "on" : "");
  return (
    <>
      <header className="appbar">
        <Finn />
        <div className="brand">Fin<span>Fluency</span></div>
        <div className="spacer" />
      </header>
      <main className="container">{children}</main>
      <nav className="nav">
        <Link href="/learn" className={cls("path")}><span className="ni">🗺️</span>Path</Link>
        <Link href="/challenge" className={cls("challenge")}><span className="ni">🎯</span>Challenge</Link>
        {isAdmin && <Link href="/admin/content" className={cls("content")}><span className="ni">✏️</span>Content</Link>}
        <Link href="/" className={cls("home")}><span className="ni">👤</span>Me</Link>
      </nav>
    </>
  );
}
