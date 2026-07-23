import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

const EMOJI = ["😞", "🙁", "😐", "🙂", "😄"];

export function MoodCheckIn({ userId }: { userId: string }) {
  const [submitting, setSubmitting] = useState(false);

  async function log(score: number) {
    setSubmitting(true);
    try {
      const { error } = await (supabase as any)
        .from("mood_entries")
        .insert({ user_id: userId, score });
      if (error) throw error;
      toast.success("Logged. Thanks for checking in.");
    } catch (e: any) {
      toast.error(e.message || "Could not log mood");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-4">
      <h3 className="font-semibold text-sm mb-1">How are you feeling right now?</h3>
      <p className="text-xs text-muted-foreground mb-3">Your caregiver can see your recent mood trend.</p>
      <div className="flex justify-between gap-1">
        {EMOJI.map((e, i) => (
          <button
            key={i}
            disabled={submitting}
            onClick={() => log(i + 1)}
            className="flex-1 py-2 rounded-md hover:bg-muted text-2xl transition disabled:opacity-50"
            aria-label={`Mood ${i + 1}`}
          >
            {e}
          </button>
        ))}
      </div>
    </Card>
  );
}
