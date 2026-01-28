import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { CountdownTimer } from "@/components/CountdownTimer";

interface Contestant {
  id: string;
  full_name: string;
  votes: number;
  photo_url: string | null;
  unique_slug: string;
}

const prizes: Record<number, string> = {
  0: "₦4,000,000",
  1: "₦2,000,000",
  2: "₦1,000,000",
  3: "Compensation",
  4: "Compensation",
};

const LeaderboardSkeleton = () => (
  <div className="max-w-2xl mx-auto px-4">
    <Skeleton className="h-7 w-32 mb-4 bg-white/20" />
    <div className="border border-white/30 rounded overflow-hidden">
      <div className="bg-white/10 p-2 sm:p-3 flex gap-4">
        <Skeleton className="h-5 w-12 bg-white/20" />
        <Skeleton className="h-5 flex-1 bg-white/20" />
        <Skeleton className="h-5 w-16 bg-white/20" />
      </div>
      {[...Array(5)].map((_, i) => (
        <div key={i} className="border-t border-white/20 p-2 sm:p-3 flex items-center gap-4">
          <Skeleton className="h-5 w-8 bg-white/20" />
          <Skeleton className="h-8 w-8 rounded-full bg-white/20" />
          <Skeleton className="h-5 flex-1 bg-white/20" />
          <Skeleton className="h-5 w-12 bg-white/20" />
        </div>
      ))}
    </div>
  </div>
);

export function Leaderboard() {
  const [contestants, setContestants] = useState<Contestant[]>([]);
  const [loading, setLoading] = useState(true);
  const [imageLoaded, setImageLoaded] = useState<Record<string, boolean>>({});

  const fetchContestants = useCallback(async () => {
    const { data, error } = await supabase
      .from("contestants")
      .select("id, full_name, votes, photo_url, unique_slug")
      .order("votes", { ascending: false });

    if (!error && data) {
      setContestants(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchContestants();

    // Subscribe to realtime updates with optimized channel
    const channel = supabase
      .channel("leaderboard-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "contestants" },
        (payload) => {
          // Optimistically update state for faster UI response
          if (payload.eventType === "UPDATE" && payload.new) {
            setContestants((prev) => {
              const updated = prev.map((c) =>
                c.id === payload.new.id ? { ...c, ...payload.new } : c
              );
              return updated.sort((a, b) => b.votes - a.votes);
            });
          } else {
            // For INSERT/DELETE, refetch the full list
            fetchContestants();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchContestants]);

  const handleImageLoad = (id: string) => {
    setImageLoaded((prev) => ({ ...prev, [id]: true }));
  };

  if (loading) {
    return <LeaderboardSkeleton />;
  }

  if (contestants.length === 0) {
    return <p className="text-center py-8 text-white/70">No contestants yet. Be the first to register!</p>;
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <CountdownTimer />
      
      <div className="overflow-x-auto bg-section-blue rounded-lg">
        <table className="w-full table-fixed">
          <thead>
            <tr className="border-b-2 border-white/30">
              <th className="text-left p-3 sm:p-4 text-sm sm:text-base w-[15%] font-semibold text-white">POS</th>
              <th className="text-left p-3 sm:p-4 text-sm sm:text-base w-[55%] font-semibold text-white">NAME</th>
              <th className="text-right p-3 sm:p-4 text-sm sm:text-base w-[30%] font-semibold text-white">VOTES</th>
            </tr>
          </thead>
          <tbody>
            {contestants.map((contestant, index) => {
              const position = index + 1;
              const ordinalSuffix = position === 1 ? "st" : position === 2 ? "nd" : position === 3 ? "rd" : "th";
              return (
                <tr key={contestant.id} className="border-b border-white/20 last:border-b-0">
                  <td className="p-3 sm:p-4 font-semibold text-sm sm:text-base text-white">{position}{ordinalSuffix}</td>
                  <td className="p-3 sm:p-4 truncate">
                    <Link
                      to={`/contestant/${contestant.unique_slug}`}
                      className="hover:underline text-sm sm:text-base text-white"
                    >
                      {contestant.full_name}
                    </Link>
                  </td>
                  <td className="p-3 sm:p-4 text-right text-sm sm:text-base whitespace-nowrap text-white">{contestant.votes.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
