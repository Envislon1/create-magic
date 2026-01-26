import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

export interface ContestDates {
  startDate: Date | null;
  endDate: Date | null;
}

export type ContestPhase = "before" | "during" | "ended";

export function useContestPhase() {
  const [dates, setDates] = useState<ContestDates>({ startDate: null, endDate: null });
  const [phase, setPhase] = useState<ContestPhase>("before");
  const [loading, setLoading] = useState(true);

  const fetchDates = useCallback(async () => {
    const { data, error } = await supabase
      .from("contest_settings")
      .select("setting_key, setting_value")
      .in("setting_key", ["contest_start_date", "contest_end_date"]);

    if (!error && data) {
      const startData = data.find(d => d.setting_key === "contest_start_date");
      const endData = data.find(d => d.setting_key === "contest_end_date");
      
      setDates({
        startDate: startData ? new Date(startData.setting_value) : null,
        endDate: endData ? new Date(endData.setting_value) : null,
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDates();
  }, [fetchDates]);

  useEffect(() => {
    if (!dates.startDate || !dates.endDate) return;

    const updatePhase = () => {
      const now = new Date().getTime();
      const startTime = dates.startDate!.getTime();
      const endTime = dates.endDate!.getTime();

      if (now < startTime) {
        setPhase("before");
      } else if (now >= startTime && now < endTime) {
        setPhase("during");
      } else {
        setPhase("ended");
      }
    };

    updatePhase();
    const interval = setInterval(updatePhase, 1000);
    return () => clearInterval(interval);
  }, [dates]);

  const formattedStartDate = dates.startDate 
    ? format(dates.startDate, "MMMM do, yyyy 'at' h:mm a") + " [GMT+1]"
    : "Loading...";

  const formattedEndDate = dates.endDate 
    ? format(dates.endDate, "MMMM do, yyyy 'at' h:mm a") + " [GMT+1]"
    : "Loading...";

  const canVote = phase === "during";
  const voteBlockedReason = phase === "before" 
    ? "Voting has not started yet" 
    : phase === "ended" 
      ? "Contest has ended" 
      : null;

  return {
    dates,
    phase,
    loading,
    formattedStartDate,
    formattedEndDate,
    canVote,
    voteBlockedReason,
  };
}
