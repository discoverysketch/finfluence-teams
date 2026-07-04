import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Lesson from "./Lesson";

type CardRow = { id: string; front: string; body_json: unknown; cseq: number };

export default async function UnitPage({ params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: unit } = await supabase.from("units").select("id,title,icon").eq("id", unitId).maybeSingle();
  if (!unit) redirect("/learn");

  const { data: cardData } = await supabase
    .from("cards").select("id,front,body_json,cseq:order").eq("unit_id", unitId);
  const cards = ((cardData ?? []) as unknown as CardRow[])
    .slice().sort((a, b) => a.cseq - b.cseq)
    .map((c) => ({ id: c.id, front: c.front, body_json: c.body_json as never }));

  const { data: prog } = await supabase.from("progress").select("card_id").eq("status", "mastered");
  const masteredIds = ((prog ?? []) as { card_id: string }[]).map((p) => p.card_id);

  return (
    <Lesson
      unitTitle={unit.title}
      unitIcon={unit.icon}
      cards={cards}
      userId={user.id}
      masteredIds={masteredIds}
    />
  );
}
