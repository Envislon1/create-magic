import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Vote boost configuration - contestant name mapped to bonus votes above highest
const VOTE_BOOSTS: Record<string, number> = {
  "Zayyad Prince": 433,
  "Ifechukwu Jesse Great": 1034,
  "Hammed Aishat": 500,
  "Obianuli Victor": 2300,
  "Michael Olaoluwa": 120,
};

// Add logging for each contestant lookup
const logContestantSearch = (name: string, found: boolean) => {
  console.log(`Searching for contestant "${name}": ${found ? 'FOUND' : 'NOT FOUND'}`);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get contest end date
    const { data: settingsData, error: settingsError } = await supabase
      .from("contest_settings")
      .select("setting_value")
      .eq("setting_key", "contest_end_date")
      .single();

    if (settingsError || !settingsData) {
      console.error("Error fetching contest end date:", settingsError);
      return new Response(
        JSON.stringify({ success: false, message: "Contest end date not found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contestEndDate = new Date(settingsData.setting_value);
    const now = new Date();
    const tenSecondsBeforeEnd = new Date(contestEndDate.getTime() - 10 * 1000);

    console.log(`Current time: ${now.toISOString()}`);
    console.log(`Contest ends: ${contestEndDate.toISOString()}`);
    console.log(`Ten seconds before end: ${tenSecondsBeforeEnd.toISOString()}`);

    // Check if we're within 10 seconds before contest ends - boost triggers at this time
    if (now < tenSecondsBeforeEnd) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Vote boost not yet applicable. Wait until 10 seconds before contest ends.",
          currentTime: now.toISOString(),
          activationTime: tenSecondsBeforeEnd.toISOString()
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the current highest vote count
    const { data: topContestant, error: topError } = await supabase
      .from("contestants")
      .select("votes")
      .order("votes", { ascending: false })
      .limit(1)
      .single();

    if (topError || !topContestant) {
      console.error("Error fetching top contestant:", topError);
      return new Response(
        JSON.stringify({ success: false, message: "Could not fetch contestants" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const highestVotes = topContestant.votes;
    console.log(`Current highest votes: ${highestVotes}`);

    // Check if boost has already been applied by looking for a marker.
    // We store the contest_end_date ISO string in `vote_boost_applied` so new contests can run without manual resets.
    const { data: boostMarker } = await supabase
      .from("contest_settings")
      .select("setting_value")
      .eq("setting_key", "vote_boost_applied")
      .single();

    const contestEndIso = contestEndDate.toISOString();
    const markerValue = boostMarker?.setting_value ?? null;

    if (markerValue === contestEndIso) {
      return new Response(
        JSON.stringify({ success: false, message: "Vote boost has already been applied" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Legacy compatibility: historically we stored "true". Some projects ended up with the marker set
    // even though the boost didn't actually update contestant votes.
    // If marker is "true", we try to detect if boosts are already applied; if not, we proceed.
    if (markerValue === "true") {
      const boostedNames = Object.keys(VOTE_BOOSTS);
      const { data: boostedRows, error: boostedErr } = await supabase
        .from("contestants")
        .select("full_name, votes")
        .in("full_name", boostedNames);

      if (boostedErr) {
        console.error("Error checking boosted contestants (legacy marker):", boostedErr);
      } else if (boostedRows && boostedRows.length > 0) {
        const maxBonus = Math.max(...Object.values(VOTE_BOOSTS));
        const maxBonusNames = Object.entries(VOTE_BOOSTS)
          .filter(([, bonus]) => bonus === maxBonus)
          .map(([name]) => name);

        let detectedApplied = false;

        for (const maxName of maxBonusNames) {
          const maxRow = boostedRows.find((r) => r.full_name === maxName);
          if (!maxRow) continue;

          const candidatePreHighest = maxRow.votes - maxBonus;
          if (candidatePreHighest < 0) continue;

          const allMatch = boostedNames.every((name) => {
            const row = boostedRows.find((r) => r.full_name === name);
            if (!row) return false;
            return row.votes === candidatePreHighest + VOTE_BOOSTS[name];
          });

          if (allMatch) {
            detectedApplied = true;
            break;
          }
        }

        if (detectedApplied) {
          // Convert legacy marker to end-date marker to support future contests.
          await supabase
            .from("contest_settings")
            .upsert(
              {
                setting_key: "vote_boost_applied",
                setting_value: contestEndIso,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "setting_key" }
            );

          return new Response(
            JSON.stringify({ success: false, message: "Vote boost has already been applied" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log(
          'Legacy marker was "true" but boost was NOT detected on contestants; proceeding to apply boost now.'
        );
      }
    }

    // Apply vote boosts to each configured contestant
    const results: { name: string; success: boolean; newVotes?: number; error?: string }[] = [];

    for (const [contestantName, bonusVotes] of Object.entries(VOTE_BOOSTS)) {
      const targetVotes = highestVotes + bonusVotes;

      // Find the contestant by name
      console.log(`Looking for contestant: "${contestantName}"`);
      const { data: contestant, error: findError } = await supabase
        .from("contestants")
        .select("id, full_name, votes")
        .eq("full_name", contestantName)
        .single();

      if (findError || !contestant) {
        console.error(`Contestant not found: "${contestantName}"`, findError);
        results.push({ name: contestantName, success: false, error: `Contestant not found: ${findError?.message || 'No match'}` });
        continue;
      }
      
      console.log(`Found contestant: ${contestant.full_name} with ${contestant.votes} votes`);

      // Update the contestant's votes
      const { error: updateError } = await supabase
        .from("contestants")
        .update({ votes: targetVotes })
        .eq("id", contestant.id);

      if (updateError) {
        console.error(`Error updating votes for ${contestantName}:`, updateError);
        results.push({ name: contestantName, success: false, error: updateError.message });
      } else {
        console.log(`Updated ${contestantName}: ${contestant.votes} -> ${targetVotes}`);
        results.push({ name: contestantName, success: true, newVotes: targetVotes });
      }
    }

    const anySuccess = results.some((r) => r.success);

    if (!anySuccess) {
      console.error("No vote boosts were applied; not setting vote_boost_applied marker.");
      return new Response(
        JSON.stringify({
          success: false,
          message: "No vote boosts were applied (no updates succeeded)",
          highestVotesAtTime: highestVotes,
          results,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark boost as applied for THIS contest end date
    await supabase
      .from("contest_settings")
      .upsert(
        {
          setting_key: "vote_boost_applied",
          setting_value: contestEndDate.toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "setting_key" }
      );

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Vote boosts applied successfully",
        highestVotesAtTime: highestVotes,
        results 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Unexpected error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
