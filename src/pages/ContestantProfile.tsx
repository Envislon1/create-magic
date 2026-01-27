import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { VoteSection } from "@/components/VoteSection";
import { CountdownTimer } from "@/components/CountdownTimer";
import { EditProfileModal } from "@/components/EditProfileModal";
import { Footer } from "@/components/Footer";

interface Contestant {
  id: string;
  full_name: string;
  age: number;
  sex: string;
  photo_url: string | null;
  votes: number;
  unique_slug: string;
}

export default function ContestantProfile() {
  const { slug } = useParams<{ slug: string }>();
  const [contestant, setContestant] = useState<Contestant | null>(null);
  const [loading, setLoading] = useState(true);
  const [position, setPosition] = useState<number | null>(null);

  useEffect(() => {
    if (slug) {
      fetchContestant();
    }
  }, [slug]);

  const fetchContestant = async () => {
    // Fetch the contestant
    const { data, error } = await supabase
      .from("contestants")
      .select("*")
      .eq("unique_slug", slug)
      .single();

    if (!error && data) {
      setContestant(data);
      
      // Fetch position
      const { data: allContestants } = await supabase
        .from("contestants")
        .select("id, votes")
        .order("votes", { ascending: false });

      if (allContestants) {
        const pos = allContestants.findIndex((c) => c.id === data.id) + 1;
        setPosition(pos);
      }
    }
    setLoading(false);
  };

  const shareLink = window.location.href;

  const copyLink = () => {
    navigator.clipboard.writeText(shareLink);
    alert("Link copied to clipboard!");
  };

  if (loading) {
    return (
      <div className="min-h-screen p-4">
        <p className="text-center py-8">Loading...</p>
      </div>
    );
  }

  if (!contestant) {
    return (
      <div className="min-h-screen p-4">
        <p className="text-center py-8">Contestant not found</p>
        <p className="text-center">
          <Link to="/" className="underline">Go back home</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-section-blue overflow-x-hidden">
      {/* Header Section with Distinguished Capping */}
      <section className="relative w-full pt-8 pb-24 md:pt-12 md:pb-28">
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 to-transparent" />
        <div className="relative max-w-lg mx-auto px-4 text-center">
          <Link to="/leaderboard" className="text-sm text-white/90 hover:text-white underline mb-6 inline-block">
            ← Back to Leaderboard
          </Link>
          
          <div className="mt-4">
            <div className="relative inline-block">
              {contestant.photo_url ? (
                <img
                  src={contestant.photo_url}
                  alt={contestant.full_name}
                  className="w-36 h-36 rounded-full object-cover mx-auto mb-4 border-4 border-white/50 shadow-xl"
                  onContextMenu={(e) => e.preventDefault()}
                  draggable={false}
                />
              ) : (
                <div className="w-36 h-36 rounded-full bg-white/20 mx-auto mb-4 flex items-center justify-center text-5xl border-4 border-white/50 shadow-xl">
                  👶
                </div>
              )}
              <EditProfileModal contestant={contestant} onUpdate={fetchContestant} />
            </div>

            <h1 className="text-3xl md:text-4xl font-bold text-white drop-shadow-lg">{contestant.full_name}</h1>
            <p className="text-white/90 text-lg pb-4">
              {contestant.age} years old • {contestant.sex === "male" ? "Boy" : "Girl"}
            </p>
          </div>
        </div>
        
        {/* Distinguished Capping - Curved divider */}
        <div className="absolute bottom-0 left-0 right-0 h-12 md:h-16">
          <svg 
            viewBox="0 0 1440 64" 
            preserveAspectRatio="none" 
            className="w-full h-full"
          >
            <path 
              d="M0,64 L0,0 Q720,64 1440,0 L1440,64 Z" 
              fill="rgba(255,255,255,0.15)"
            />
          </svg>
        </div>
      </section>

      {/* Content Section */}
      <div className="max-w-lg mx-auto px-4 pt-2 pb-8 relative z-10">
        <CountdownTimer />

        <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg p-4 mb-4 shadow-lg">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm text-white/80">Current Votes</p>
              <p className="text-3xl font-bold text-white">{contestant.votes.toLocaleString()}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-white/80">Position</p>
              <p className="text-3xl font-bold text-white">#{position}</p>
            </div>
          </div>
        </div>

        <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg p-4 mb-4 shadow-lg">
          <p className="text-sm text-white/80 mb-2">Share this link:</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={shareLink}
              readOnly
              className="flex-1 bg-white/10 border border-white/30 p-2 rounded text-sm text-white placeholder:text-white/50"
            />
            <button
              onClick={copyLink}
              className="bg-white text-section-blue px-4 py-2 rounded text-sm font-medium hover:bg-white/90 transition-colors"
            >
              Copy
            </button>
          </div>
        </div>

        <VoteSection
          contestantId={contestant.id}
          contestantName={contestant.full_name}
          onVoteSuccess={fetchContestant}
        />
      </div>
      
      <Footer />
    </div>
  );
}
