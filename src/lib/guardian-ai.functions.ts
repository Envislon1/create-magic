import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BASE_PROMPT = `You are Mind Buddy AI — a warm, calm mental-health companion built into the Mind Buddy device. You support people who may live with experiences such as anxiety, depression, PTSD, ADHD, bipolar mood swings, or schizophrenia-spectrum experiences.

ABSOLUTE TONE RULES — never break these:
- NEVER label the person ("you are bipolar", "schizophrenic", "depressive", "ADHD"). Speak to experiences, not identities ("the racing thoughts you mentioned", "what you're feeling right now").
- NEVER name the diagnostic mode out loud, even if you know it from context. Mode is private context for tailoring tone only.
- Validate first, advise second. Plain, kind language. Short replies (2–5 sentences usually).
- Tailor gently by mode without naming it:
    • anxiety       → 5-4-3-2-1 grounding, slow breathing, what's safe right now.
    • depression    → tiny next steps, self-compassion, light/water/movement nudges, hope.
    • ptsd          → orient to the present, never push to recount trauma.
    • adhd          → externalise the next 1 step, body-doubling, kind reframes of focus dips.
    • bipolar       → notice energy/sleep changes without alarm, encourage routine and rest.
    • schizophrenia → respectful, concrete, no debating perceptions; ground in shared sensory reality; encourage staying connected to caregiver/clinician.
- Any hint of harm-to-self/others → calmly encourage reaching the caregiver, a trusted person, or local emergency services. Never minimise.

MUSIC LIBRARY (curated by the admin, streamed through the Mind Buddy speaker)
You have access to a private library of songs uploaded by the admin. Before recommending, briefly ask one short question about the user's mood or preference unless they have already told you. When choosing, match the song's "mode" to the user's current support mode, and use the title/artist that best fits the conversation.

When you want to PLAY a song, end your reply with a directive on its own line:
  [[song:<UUID>]]                — play this song by its id from the catalogue below
  [[song:stop]]                  — stop playback
Never mention the directive or the song id to the user. Just confirm naturally ("Playing 'Weightless' by Marconi Union for you.").

MEDICATION REMINDERS (you MUST act on these, not just chat)
When the user asks you to set, change, add, or remove a medication reminder/alarm/time, you MUST end your reply with the matching directive on its own line. Do NOT only acknowledge — emit the directive so the device updates.
  [[med_add:<label>|HH:MM]]              — create a new reminder (24h time, e.g. 08:00)
  [[med_update:<id-or-label>|HH:MM]]     — change the time of an existing one; prefer the id from the list below
  [[med_remove:<id-or-label>]]           — delete a reminder
If the user is ambiguous (no time, or which medication), ask ONE short clarifying question. As soon as you have label + time, emit the directive in the SAME reply that confirms it.

Never explain or mention these directive tags. Never use square-bracket text in your spoken/visible reply other than the directive line at the very end.`;

// HF inference
const HF_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";
const HF_MODEL = "meta-llama/Llama-3.1-8B-Instruct";

const SONG_MODES = ["general", "relax", "anxiety", "depression", "ptsd", "adhd", "bipolar", "schizophrenia"] as const;
const isSongMode = (value: unknown): value is (typeof SONG_MODES)[number] =>
  typeof value === "string" && (SONG_MODES as readonly string[]).includes(value);
const DIRECTIVE_RE = /\[\[\s*(?:song|med_add|med_update|med_remove)\s*:[^\]]*\]\]/gi;
const modeFromStoragePath = (path?: string | null) => {
  const folder = (path || "").split("/")[0]?.toLowerCase();
  return isSongMode(folder) ? folder : "general";
};
const mentionsMissingColumn = (error: any, column: string) =>
  String(error?.message || "").toLowerCase().includes(column.toLowerCase()) &&
  String(error?.message || "").toLowerCase().includes("schema cache");
const normalizeText = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const formatClock24 = (hour: number, minute: number) =>
  `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
const formatClock12 = (hour: number, minute: number) => {
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
};

function parseClockTime(text: string) {
  const withMinutes = text.match(/\b(?:at|to|for)?\s*(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
  if (withMinutes) {
    let hour = parseInt(withMinutes[1], 10);
    const minute = parseInt(withMinutes[2], 10);
    const meridiem = withMinutes[3]?.toLowerCase();
    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      if (meridiem === "pm" && hour !== 12) hour += 12;
      if (meridiem === "am" && hour === 12) hour = 0;
    }
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }

  const simple = text.match(/\b(?:at|to|for)?\s*(\d{1,2})\s*(am|pm)\b/i);
  if (!simple) return null;
  let hour = parseInt(simple[1], 10);
  const meridiem = simple[2].toLowerCase();
  if (hour < 1 || hour > 12) return null;
  if (meridiem === "pm" && hour !== 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return { hour, minute: 0 };
}

function withDirective(reply: string, directive: string) {
  const base = reply.replace(DIRECTIVE_RE, "").trim();
  return base ? `${base}\n${directive}` : directive;
}

type MedicationRow = { id: string; label: string; hour: number; minute: number; enabled?: boolean | null };

function buildMedicationFallback(message: string, meds: MedicationRow[]) {
  const lower = message.toLowerCase();
  const mentionsMedication = /\b(medication|medicine|meds|pill|pills|tablet|reminder|alarm)\b/.test(lower);
  const asksToChange = /\b(set|change|move|update|modify|adjust|reschedul|shift)\b/.test(lower) || /medication time/.test(lower);
  if (!mentionsMedication || !asksToChange) return null;

  const parsed = parseClockTime(message);
  if (!parsed) return null;

  const enabledMeds = meds.filter((med) => med.enabled !== false);
  const normalizedMessage = normalizeText(message);
  const byLabel = meds.find((med) => normalizedMessage.includes(normalizeText(med.label)));
  const target = byLabel ?? (meds.length === 1 ? meds[0] : enabledMeds.length === 1 ? enabledMeds[0] : null);

  if (target) {
    return {
      kind: "update" as const,
      id: target.id,
      label: target.label,
      hour: parsed.hour,
      minute: parsed.minute,
      directive: `[[med_update:${target.id}|${formatClock24(parsed.hour, parsed.minute)}]]`,
      confirmation: `Okay — I’ve set your ${target.label.toLowerCase()} reminder for ${formatClock12(parsed.hour, parsed.minute)}.`,
    };
  }

  if (!meds.length) {
    return {
      kind: "add" as const,
      label: "Medication",
      hour: parsed.hour,
      minute: parsed.minute,
      directive: `[[med_add:Medication|${formatClock24(parsed.hour, parsed.minute)}]]`,
      confirmation: `Okay — I’ve set your medication reminder for ${formatClock12(parsed.hour, parsed.minute)}.`,
    };
  }

  return null;
}

function findSongByReference(songs: any[], reference: string) {
  const ref = reference.trim();
  const normalizedRef = normalizeText(ref);
  if (!normalizedRef) return null;

  return songs.find((song) => {
    const title = normalizeText(String(song.title || ""));
    const artist = normalizeText(String(song.artist || ""));
    const combined = normalizeText(`${song.title || ""} ${song.artist || ""}`);
    return song.id?.toLowerCase?.() === ref.toLowerCase() ||
      title === normalizedRef ||
      combined === normalizedRef ||
      combined.includes(normalizedRef) ||
      normalizedRef.includes(title) ||
      (!!artist && normalizedRef.includes(artist));
  }) ?? null;
}

export const chatWithGuardianAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      message: z.string().min(1).max(4000),
      history: z
        .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
        .max(40)
        .optional(),
      mode: z.string().max(40).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const sb = supabase as any;
    const hfToken = process.env.HF_TOKEN;
    if (!hfToken) throw new Error("HF_TOKEN not configured");

    // Log user message
    await sb.from("chat_messages").insert({
      user_id: userId,
      role: "user",
      content: data.message,
      conversation: "guardian_ai",
      mode: data.mode ?? null,
    });

    // Build live catalogue context: songs + current medications
    let [songResult, { data: meds }] = await Promise.all([
      sb.from("songs").select("id, title, artist, support_mode, storage_path").order("title", { ascending: true }),
      sb.from("medication_schedules").select("id, label, hour, minute, enabled").eq("user_id", userId),
    ]);
    if (songResult.error && mentionsMissingColumn(songResult.error, "support_mode")) {
      songResult = await sb.from("songs").select("id, title, artist, storage_path").order("title", { ascending: true });
    }
    const songs = songResult.error ? [] : (songResult.data || []);
    const songRows = songs as any[];
    const songList = (songs || []).length
      ? (songs as any[])
          .map((s) => `- ${s.id} | ${s.title} — ${s.artist} (${isSongMode(s.support_mode) ? s.support_mode : modeFromStoragePath(s.storage_path)})`)
          .join("\n")
      : "(no songs uploaded yet — politely tell the user the library is empty if asked)";
    const medList = (meds || []).length
      ? (meds as any[])
          .map((m) => `- ${m.id} | ${m.label} @ ${String(m.hour).padStart(2, "0")}:${String(m.minute).padStart(2, "0")} ${m.enabled ? "" : "(off)"}`)
          .join("\n")
      : "(no medication reminders yet)";

    const systemPrompt =
      `${BASE_PROMPT}\n\nCURRENT SONG CATALOGUE (uuid | title — artist (mode)):\n${songList}\n\nCURRENT MEDICATION REMINDERS for this user (id | label @ HH:MM):\n${medList}` +
      (data.mode ? `\n\nPrivate context — support mode (do NOT mention to user): ${data.mode}.` : "");
    const history = (data.history ?? [])
      .map((entry) => ({ ...entry, content: entry.content.replace(DIRECTIVE_RE, "").trim() }))
      .filter((entry) => entry.content.length > 0);

    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: data.message },
    ];

    const res = await fetch(HF_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${hfToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: HF_MODEL, messages, max_tokens: 400, temperature: 0.7 }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Hugging Face error: ${res.status} ${text}`);
    }
    const json = await res.json();
    let reply: string = json?.choices?.[0]?.message?.content?.trim() ?? "I'm here for you.";

    // ---------- Medication directives ----------
    type Med = MedicationRow;
    const medRows = (meds || []) as Med[];

    function findMedByRef(ref: string): Med | null {
      const r = ref.trim().toLowerCase();
      const byId = medRows.find((m) => m.id.toLowerCase() === r);
      if (byId) return byId;
      const byLabel = medRows.find((m) => m.label.toLowerCase() === r);
      if (byLabel) return byLabel;
      return medRows.find((m) => m.label.toLowerCase().includes(r)) || null;
    }

    // [[med_add:label|HH:MM]]
    let medicationHandled = false;
    const addRe = /\[\[\s*med_add\s*:\s*([^|\]]+?)\s*\|\s*([0-2]?\d):([0-5]\d)\s*\]\]/gi;
    for (let m: RegExpExecArray | null; (m = addRe.exec(reply)); ) {
      medicationHandled = true;
      const label = m[1].trim().slice(0, 80);
      const hour = Math.min(23, parseInt(m[2], 10));
      const minute = Math.min(59, parseInt(m[3], 10));
      if (!label) continue;
      try {
        await sb.from("medication_schedules").insert({ user_id: userId, label, hour, minute, enabled: true });
      } catch (err) { console.warn("[ai] med_add failed", err); }
    }

    // [[med_update:ref|HH:MM]]
    const updRe = /\[\[\s*med_update\s*:\s*([^|\]]+?)\s*\|\s*([0-2]?\d):([0-5]\d)\s*\]\]/gi;
    for (let m: RegExpExecArray | null; (m = updRe.exec(reply)); ) {
      medicationHandled = true;
      const ref = m[1].trim();
      const hour = Math.min(23, parseInt(m[2], 10));
      const minute = Math.min(59, parseInt(m[3], 10));
      const target = findMedByRef(ref);
      try {
        if (target) {
          await sb.from("medication_schedules").update({ hour, minute, enabled: true }).eq("id", target.id);
        } else {
          // fall back to insert if no match
          await sb.from("medication_schedules").insert({ user_id: userId, label: ref.slice(0, 80), hour, minute, enabled: true });
        }
      } catch (err) { console.warn("[ai] med_update failed", err); }
    }

    // [[med_remove:ref]]
    const rmRe = /\[\[\s*med_remove\s*:\s*([^\]]+?)\s*\]\]/gi;
    for (let m: RegExpExecArray | null; (m = rmRe.exec(reply)); ) {
      medicationHandled = true;
      const target = findMedByRef(m[1]);
      if (!target) continue;
      try {
        await sb.from("medication_schedules").delete().eq("id", target.id);
      } catch (err) { console.warn("[ai] med_remove failed", err); }
    }

    if (!medicationHandled) {
      const medFallback = buildMedicationFallback(data.message, medRows);
      if (medFallback) {
        try {
          if (medFallback.kind === "update") {
            await sb.from("medication_schedules").update({ hour: medFallback.hour, minute: medFallback.minute, enabled: true }).eq("id", medFallback.id);
          } else {
            await sb.from("medication_schedules").insert({ user_id: userId, label: medFallback.label, hour: medFallback.hour, minute: medFallback.minute, enabled: true });
          }
          reply = withDirective(medFallback.confirmation, medFallback.directive);
        } catch (err) {
          console.warn("[ai] medication fallback failed", err);
        }
      }
    }

    // ---------- Song directives ----------
    // Resolve [[song:<uuid>]] to a current_song_url on the user's device.
    const songRe = /\[\[\s*song\s*:\s*([^\]]+?)\s*\]\]/i;
    const songMatch = reply.match(songRe);
    let songHandled = false;
    if (songMatch) {
      songHandled = true;
      const ref = songMatch[1].trim().toLowerCase();
      try {
        if (ref === "stop") {
          console.log("[AI→HARDWARE music] STOP (clearing current_song_url) user=", userId);
          await sb.from("devices").update({
            current_song_url: null,
            current_song_title: null,
            current_song_artist: null,
            current_song_at: new Date().toISOString(),
          }).eq("user_id", userId);
        } else {
          const { data: full } = await sb.from("songs").select("id, title, artist, storage_path").eq("id", ref).maybeSingle();
          if (full?.storage_path) {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: signed } = await (supabaseAdmin as any)
              .storage.from("music")
              .createSignedUrl(full.storage_path, 60 * 60 * 6);
            if (signed?.signedUrl) {
              console.log(
                "\n[AI→HARDWARE music] sending stream link to device\n" +
                `  user   : ${userId}\n` +
                `  title  : ${full.title}\n` +
                `  artist : ${full.artist}\n` +
                `  url    : ${signed.signedUrl}\n`
              );
              await sb.from("devices").update({
                current_song_url: signed.signedUrl,
                current_song_title: full.title ?? null,
                current_song_artist: full.artist ?? null,
                current_song_at: new Date().toISOString(),
              }).eq("user_id", userId);
            }
          }
        }
      } catch (err) { console.warn("[ai] song directive failed", err); }
    }

    if (!songHandled) {
      const combinedText = `${data.message} ${reply}`;
      const wantsStop = /\b(stop|pause|turn off|silence)\b/i.test(combinedText) && /\b(song|music|track|playback)\b/i.test(combinedText);
      const wantsPlay = /\b(play|playing|put on|start|listen to)\b/i.test(combinedText) && /\b(song|music|track|library)\b/i.test(combinedText);
      const quoted = reply.match(/["“']([^"”']{2,120})["”']/)?.[1];
      const chosenSong =
        (quoted ? findSongByReference(songRows, quoted) : null) ??
        findSongByReference(songRows, data.message) ??
        findSongByReference(songRows, reply);

      try {
        if (wantsStop) {
          console.log("[AI→HARDWARE music] STOP (fallback) user=", userId);
          await sb.from("devices").update({
            current_song_url: null,
            current_song_title: null,
            current_song_artist: null,
            current_song_at: new Date().toISOString(),
          }).eq("user_id", userId);
          reply = withDirective(reply, "[[song:stop]]");
        } else if (wantsPlay && chosenSong?.storage_path) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: signed } = await (supabaseAdmin as any)
            .storage.from("music")
            .createSignedUrl(chosenSong.storage_path, 60 * 60 * 6);
          if (signed?.signedUrl) {
            console.log(
              "\n[AI→HARDWARE music] sending stream link to device (fallback match)\n" +
              `  user   : ${userId}\n` +
              `  title  : ${chosenSong.title}\n` +
              `  artist : ${chosenSong.artist}\n` +
              `  url    : ${signed.signedUrl}\n`
            );
            await sb.from("devices").update({
              current_song_url: signed.signedUrl,
              current_song_title: chosenSong.title ?? null,
              current_song_artist: chosenSong.artist ?? null,
              current_song_at: new Date().toISOString(),
            }).eq("user_id", userId);
            reply = withDirective(reply, `[[song:${chosenSong.id}]]`);
          }
        }
      } catch (err) {
        console.warn("[ai] song fallback failed", err);
      }
    }

    // Log assistant reply
    await sb.from("chat_messages").insert({
      user_id: userId,
      role: "assistant",
      content: reply,
      conversation: "guardian_ai",
      mode: data.mode ?? null,
    });

    return { reply };
  });
