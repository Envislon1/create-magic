import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

type Mood = { id: string; score: number; note: string | null; created_at: string };

export function MoodChart({ patientId }: { patientId: string }) {
  const [rows, setRows] = useState<Mood[]>([]);

  useEffect(() => {
    let live = true;
    async function load() {
      const { data } = await (supabase as any)
        .from("mood_entries")
        .select("id, score, note, created_at")
        .eq("user_id", patientId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (live) setRows(((data || []) as Mood[]).reverse());
    }
    void load();
    const ch = supabase
      .channel(`mood-${patientId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mood_entries", filter: `user_id=eq.${patientId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      live = false;
      supabase.removeChannel(ch);
    };
  }, [patientId]);

  const data = rows.map((r) => ({
    t: new Date(r.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    score: r.score,
    note: r.note,
  }));

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm">Mood — last {rows.length || 20}</h3>
        <span className="text-xs text-muted-foreground">1 (low) → 5 (great)</span>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No mood check-ins yet. The patient can log how they feel from their dashboard.
        </p>
      ) : (
        <div className="h-48 w-full">
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="t" tick={{ fontSize: 10 }} hide />
              <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 10 }} width={24} />
              <Tooltip
                contentStyle={{ fontSize: 12, background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }}
                labelFormatter={(l) => l as string}
              />
              <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
