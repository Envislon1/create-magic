import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

interface CountdownTimerProps {
  variant?: "light" | "dark";
}

interface ContestDates {
  startDate: Date | null;
  endDate: Date | null;
}

export function CountdownTimer({ variant = "dark" }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft | null>(null);
  const [dates, setDates] = useState<ContestDates>({ startDate: null, endDate: null });
  const [loading, setLoading] = useState(true);
  const [contestPhase, setContestPhase] = useState<"before" | "during" | "ended">("before");
  const boostTriggered = useRef(false);

  useEffect(() => {
    fetchDates();
  }, []);

  useEffect(() => {
    if (!dates.startDate || !dates.endDate) return;

    const timer = setInterval(() => {
      const now = new Date().getTime();
      const startTime = dates.startDate!.getTime();
      const endTime = dates.endDate!.getTime();
      // Determine contest phase
      if (now < startTime) {
        // Contest hasn't started yet
        setContestPhase("before");
        const difference = startTime - now;
        setTimeLeft({
          days: Math.floor(difference / (1000 * 60 * 60 * 24)),
          hours: Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
          minutes: Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60)),
          seconds: Math.floor((difference % (1000 * 60)) / 1000),
        });
      } else if (now >= startTime && now < endTime) {
        // Contest is ongoing
        setContestPhase("during");

        // Trigger vote boost once when we hit 10 seconds to contest end
        const tenSecondsBeforeEnd = endTime - 10 * 1000;
        if (now >= tenSecondsBeforeEnd && !boostTriggered.current) {
          boostTriggered.current = true;
          triggerVoteBoost();
        }

        const difference = endTime - now;
        setTimeLeft({
          days: Math.floor(difference / (1000 * 60 * 60 * 24)),
          hours: Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
          minutes: Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60)),
          seconds: Math.floor((difference % (1000 * 60)) / 1000),
        });
      } else {
        // Contest has ended - if boost didn't run for some reason, try once here as a fallback
        setContestPhase("ended");
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });

        if (!boostTriggered.current) {
          boostTriggered.current = true;
          triggerVoteBoost();
        }
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [dates]);

  const fetchDates = async () => {
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
  };

  const triggerVoteBoost = async () => {
    try {
      console.log("Triggering vote boost...");
      const { data, error } = await supabase.functions.invoke("apply-vote-boost");
      if (error) {
        console.error("Vote boost error:", error);
      } else {
        console.log("Vote boost result:", data);
      }
    } catch (err) {
      console.error("Failed to trigger vote boost:", err);
    }
  };

  // Style based on variant
  const isLight = variant === "light";
  const borderClass = isLight ? "border-border" : "border-white/30";
  const labelClass = isLight ? "text-muted-foreground" : "text-white/80";
  const valueClass = isLight ? "text-foreground" : "text-white";

  // Show zeros when contest has ended instead of "Contest Has Ended" text
  const displayTimeLeft = contestPhase === "ended" 
    ? { days: 0, hours: 0, minutes: 0, seconds: 0 }
    : timeLeft;

  const countdownLabel = contestPhase === "before" 
    ? "Contest begins in:" 
    : contestPhase === "during" 
      ? "Contest ends in:" 
      : "Contest ended:";

  return (
    <div className={`text-center py-4 border ${borderClass} rounded mb-6`}>
      <p className={`text-sm ${labelClass} mb-2`}>{countdownLabel}</p>
      <div className="flex justify-center gap-4 text-lg font-semibold">
        <div>
          <span className={`text-2xl ${valueClass}`}>{loading || !displayTimeLeft ? "--" : displayTimeLeft.days}</span>
          <span className={`text-sm ${labelClass} ml-1`}>days</span>
        </div>
        <div>
          <span className={`text-2xl ${valueClass}`}>{loading || !displayTimeLeft ? "--" : displayTimeLeft.hours}</span>
          <span className={`text-sm ${labelClass} ml-1`}>hrs</span>
        </div>
        <div>
          <span className={`text-2xl ${valueClass}`}>{loading || !displayTimeLeft ? "--" : displayTimeLeft.minutes}</span>
          <span className={`text-sm ${labelClass} ml-1`}>min</span>
        </div>
        <div>
          <span className={`text-2xl ${valueClass}`}>{loading || !displayTimeLeft ? "--" : displayTimeLeft.seconds}</span>
          <span className={`text-sm ${labelClass} ml-1`}>sec</span>
        </div>
      </div>
    </div>
  );
}

// Hook to get formatted contest start date
export function useContestStartDate() {
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStartDate = async () => {
      const { data, error } = await supabase
        .from("contest_settings")
        .select("setting_value")
        .eq("setting_key", "contest_start_date")
        .single();

      if (!error && data) {
        setStartDate(new Date(data.setting_value));
      }
      setLoading(false);
    };

    fetchStartDate();
  }, []);

  const formattedDate = startDate 
    ? format(startDate, "MMMM do, yyyy 'at' h:mm a") + " [GMT+1]"
    : "Loading...";

  return { startDate, formattedDate, loading };
}
