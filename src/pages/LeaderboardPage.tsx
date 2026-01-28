import { Leaderboard } from "@/components/Leaderboard";

const LeaderboardPage = () => {
  return (
    <div className="min-h-screen bg-section-blue">
      {/* Blue Header Section */}
      <div className="py-12 px-4 text-section-blue-foreground">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-3xl font-bold mb-2">Leaderboard</h1>
          <p className="text-white/80">
            See who's leading the contest. <span className="text-yellow-300 font-semibold">Click on a contestant name to vote for them!</span>
          </p>
        </div>
      </div>
      
      {/* Leaderboard Section */}
      <div className="px-4 pb-12">
        <div className="max-w-3xl mx-auto">
          <Leaderboard />
        </div>
      </div>
    </div>
  );
};

export default LeaderboardPage;
