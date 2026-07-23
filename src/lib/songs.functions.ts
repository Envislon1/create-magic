import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const SONG_MODES = [
  "general",
  "relax",
  "anxiety",
  "depression",
  "ptsd",
  "adhd",
  "bipolar",
  "schizophrenia",
] as const;

const ADMIN_EMAILS = ["wuf.tech@gmail.com", "wuf.device@gmail.com"];
const isAdminEmail = (e?: string | null) => ADMIN_EMAILS.includes((e || "").toLowerCase());

type Song = { id: string; title: string; artist: string; mode: string; storage_path: string; created_at: string };

const isSongMode = (value: unknown): value is (typeof SONG_MODES)[number] =>
  typeof value === "string" && (SONG_MODES as readonly string[]).includes(value);

const modeFromStoragePath = (path?: string | null) => {
  const folder = (path || "").split("/")[0]?.toLowerCase();
  return isSongMode(folder) ? folder : "general";
};

const normalizeSong = (row: any): Song => ({
  id: row.id,
  title: row.title,
  artist: row.artist,
  mode: isSongMode(row.support_mode) ? row.support_mode : modeFromStoragePath(row.storage_path),
  storage_path: row.storage_path,
  created_at: row.created_at,
});

const mentionsMissingColumn = (error: any, column: string) =>
  String(error?.message || "").toLowerCase().includes(column.toLowerCase()) &&
  String(error?.message || "").toLowerCase().includes("schema cache");

/** Check whether the current authenticated user is the admin. */
export const isCurrentUserAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as any)?.email as string | undefined;
    return { admin: isAdminEmail(email) };
  });

/** List songs (catalogue) — visible to any authenticated user. */
export const listSongs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    let result = await sb
      .from("songs")
      .select("id, title, artist, support_mode, storage_path, created_at")
      .order("title", { ascending: true });
    if (result.error && mentionsMissingColumn(result.error, "support_mode")) {
      result = await sb
        .from("songs")
        .select("id, title, artist, storage_path, created_at")
        .order("title", { ascending: true });
    }
    if (result.error) throw new Error(result.error.message);
    return { songs: ((result.data ?? []) as any[]).map(normalizeSong) };
  });

/** Mint a short-lived signed URL the hardware/web player can stream. */
export const getSongStreamUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ songId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: song, error } = await sb
      .from("songs")
      .select("id, title, artist, storage_path")
      .eq("id", data.songId)
      .maybeSingle();
    if (error || !song) throw new Error("Song not found");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: signErr } = await (supabaseAdmin as any)
      .storage.from("music")
      .createSignedUrl(song.storage_path, 60 * 60 * 6);
    if (signErr || !signed?.signedUrl) throw new Error(signErr?.message || "Could not sign URL");
    return { url: signed.signedUrl as string, song };
  });

/** Admin-only: register an uploaded song row (file already in the bucket). */
export const adminCreateSong = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      title: z.string().min(1).max(120),
      artist: z.string().min(1).max(120),
      mode: z.enum(SONG_MODES),
      storage_path: z.string().min(1).max(400),
      duration_seconds: z.number().int().positive().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = ((context.claims as any)?.email || "").toLowerCase();
    if (!isAdminEmail(email)) throw new Error("Forbidden");
    const sb = context.supabase as any;
    const payload = {
      title: data.title,
      artist: data.artist,
      support_mode: data.mode,
      storage_path: data.storage_path,
      duration_seconds: data.duration_seconds ?? null,
    };
    let { error } = await sb.from("songs").insert(payload);
    if (error && mentionsMissingColumn(error, "support_mode")) {
      const fallbackPayload = { ...payload } as any;
      delete fallbackPayload.support_mode;
      const fallback = await sb.from("songs").insert(fallbackPayload);
      error = fallback.error;
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin-only: delete a song row and its storage object. */
export const adminDeleteSong = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const email = ((context.claims as any)?.email || "").toLowerCase();
    if (!isAdminEmail(email)) throw new Error("Forbidden");
    const sb = context.supabase as any;
    const { data: song } = await sb
      .from("songs")
      .select("storage_path")
      .eq("id", data.id)
      .maybeSingle();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (song?.storage_path) {
      await (supabaseAdmin as any).storage.from("music").remove([song.storage_path]);
    }
    const { error } = await sb.from("songs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin-only: mint a signed upload URL so the browser can PUT the file directly to storage (with progress). */
export const adminCreateSongUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      mode: z.enum(SONG_MODES),
      filename: z.string().min(1).max(200),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const email = ((context.claims as any)?.email || "").toLowerCase();
    if (!isAdminEmail(email)) throw new Error("Forbidden");
    const safe = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${data.mode}/${Date.now()}_${safe}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await (supabaseAdmin as any)
      .storage.from("music")
      .createSignedUploadUrl(path);
    if (error || !signed?.signedUrl) throw new Error(error?.message || "Could not sign upload URL");
    return { path, signedUrl: signed.signedUrl as string, token: signed.token as string };
  });
