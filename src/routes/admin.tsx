import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import {
  listSongs,
  adminCreateSong,
  adminCreateSongUploadUrl,
  adminDeleteSong,
  isCurrentUserAdmin,
  SONG_MODES,
} from "@/lib/songs.functions";
import {
  adminListManuals,
  adminCreateManualUploadUrl,
  adminPublishManual,
} from "@/lib/manuals.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Loader2, Trash2, Upload, Music, LogOut, FileText, Download } from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin · Mind Buddy Music Library" }] }),
  component: AdminPage,
});

type Song = { id: string; title: string; artist: string; mode: string; storage_path: string; created_at: string };

function AdminPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const list = useServerFn(listSongs);
  const create = useServerFn(adminCreateSong);
  const createUploadUrl = useServerFn(adminCreateSongUploadUrl);
  const remove = useServerFn(adminDeleteSong);
  const checkAdmin = useServerFn(isCurrentUserAdmin);
  const listManuals = useServerFn(adminListManuals);
  const createManualUploadUrl = useServerFn(adminCreateManualUploadUrl);
  const publishManual = useServerFn(adminPublishManual);

  const ADMIN_EMAILS = ["wuf.tech@gmail.com", "wuf.device@gmail.com"];
  const admin = !!user && ADMIN_EMAILS.includes((user.email || "").toLowerCase());

  const [songs, setSongs] = useState<Song[]>([]);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [mode, setMode] = useState<(typeof SONG_MODES)[number]>("general");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string>("");
  const [ready, setReady] = useState(false);

  // Manual upload state
  type ManualRow = {
    id: string;
    file_url: string;
    file_name: string;
    version: string | null;
    size_bytes: number | null;
    created_at: string;
    is_active: boolean;
  };
  const [manuals, setManuals] = useState<ManualRow[]>([]);
  const [manualFile, setManualFile] = useState<File | null>(null);
  const [manualVersion, setManualVersion] = useState("");
  const [manualUploading, setManualUploading] = useState(false);
  const [manualProgress, setManualProgress] = useState(0);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    if (!admin) {
      toast.error("Admin access only");
      navigate({ to: "/app" });
      return;
    }
    setReady(true);
    refresh().catch((e: any) =>
      toast.error(e?.message?.includes("schema cache")
        ? "Songs table not found — run docs/2026-06-09-music-admin-mood.sql in the database."
        : (e?.message || "Failed to load songs")),
    );
    refreshManuals().catch(() => {
      /* manuals table may not exist yet */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, admin]);

  async function refresh() {
    const { songs } = await list({});
    setSongs(songs as Song[]);
  }

  async function refreshManuals() {
    const { manuals } = await listManuals({});
    setManuals(manuals as ManualRow[]);
  }

  async function onUploadManual(e: React.FormEvent) {
    e.preventDefault();
    if (!manualFile) {
      toast.error("Choose a file first");
      return;
    }
    setManualUploading(true);
    setManualProgress(0);
    try {
      const { path, signedUrl } = await createManualUploadUrl({
        data: { filename: manualFile.name },
      });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signedUrl, true);
        xhr.setRequestHeader(
          "Content-Type",
          manualFile.type || "application/pdf",
        );
        xhr.setRequestHeader("x-upsert", "false");
        xhr.timeout = 120_000;
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable)
            setManualProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed (${xhr.status})`));
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.ontimeout = () => reject(new Error("Upload timed out"));
        xhr.send(manualFile);
      });
      await publishManual({
        data: {
          storage_path: path,
          file_name: manualFile.name,
          version: manualVersion.trim() || undefined,
          size_bytes: manualFile.size,
        },
      });
      toast.success("Manual published — live on the landing page");
      setManualFile(null);
      setManualVersion("");
      const input = document.getElementById(
        "manual-file",
      ) as HTMLInputElement | null;
      if (input) input.value = "";
      await refreshManuals();
    } catch (err: any) {
      console.error("[admin manual upload]", err);
      toast.error(err?.message || "Manual upload failed");
    } finally {
      setManualUploading(false);
      setManualProgress(0);
    }
  }

  const grouped = useMemo(() => {
    const m: Record<string, Song[]> = {};
    for (const s of songs) (m[s.mode] ||= []).push(s);
    return m;
  }, [songs]);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title.trim() || !artist.trim()) {
      toast.error("Title, artist and file are required");
      return;
    }
    setUploading(true);
    setProgress(0);
    setStage("Preparing upload…");
    try {
      // 1) Ask the server for a signed upload URL (uses service role; bypasses storage RLS).
      const { path, signedUrl } = await createUploadUrl({
        data: { mode, filename: file.name },
      });

      // 2) PUT the file directly to storage via XHR so we get real progress + a hard timeout.
      setStage("Uploading file…");
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signedUrl, true);
        xhr.setRequestHeader("Content-Type", file.type || "audio/mpeg");
        xhr.setRequestHeader("x-upsert", "false");
        xhr.timeout = 120_000; // 2 min hard cap so it can never hang silently
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Storage upload failed (${xhr.status}): ${xhr.responseText || xhr.statusText}`));
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.ontimeout = () => reject(new Error("Upload timed out after 2 minutes"));
        xhr.send(file);
      });

      // 3) Register the row in `songs`.
      setStage("Saving song…");
      setProgress(100);
      await create({
        data: { title: title.trim(), artist: artist.trim(), mode, storage_path: path },
      });
      toast.success("Song added");
      setTitle(""); setArtist(""); setFile(null);
      const input = document.getElementById("song-file") as HTMLInputElement | null;
      if (input) input.value = "";
      await refresh();
    } catch (err: any) {
      console.error("[admin upload]", err);
      toast.error(err?.message || "Upload failed");
    } finally {
      setUploading(false);
      setProgress(0);
      setStage("");
    }
  }



  async function onDelete(id: string) {
    if (!confirm("Delete this song?")) return;
    try {
      await remove({ data: { id } });
      toast.success("Deleted");
      await refresh();
    } catch (e: any) {
      toast.error(e.message || "Delete failed");
    }
  }

  if (loading || !ready) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading admin…</div>;
  }
  if (!admin) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border/60">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-safe flex items-center justify-center">
              <Music className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-semibold">Mind Buddy · Admin</div>
              <div className="text-xs text-muted-foreground">{user?.email}</div>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => supabase.auth.signOut()}>
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <Card className="p-5">
          <h2 className="font-semibold mb-3">Add a song</h2>
          <form onSubmit={onUpload} className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Artist</Label>
              <Input value={artist} onChange={(e) => setArtist(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Mode</Label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as any)}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                {SONG_MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>File (mp3/m4a)</Label>
              <Input id="song-file" type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Button type="submit" disabled={uploading} className="w-full">
                {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                {uploading ? "Uploading…" : "Upload"}
              </Button>
              {uploading && (
                <div className="space-y-1">
                  <Progress value={progress} />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{stage}</span>
                    <span>{progress}%</span>
                  </div>
                </div>
              )}
            </div>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold mb-3">Library ({songs.length})</h2>
          {songs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No songs yet.</p>
          ) : (
            <div className="space-y-4">
              {Object.entries(grouped).map(([m, arr]) => (
                <div key={m}>
                  <h3 className="text-xs font-medium uppercase text-muted-foreground mb-1">{m}</h3>
                  <ul className="divide-y divide-border/60">
                    {arr.map((s) => (
                      <li key={s.id} className="py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{s.title}</div>
                          <div className="text-xs text-muted-foreground truncate">{s.artist}</div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => onDelete(s.id)} aria-label="Delete">
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold mb-1 flex items-center gap-2">
            <FileText className="w-4 h-4" /> Product manual
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            Upload a new PDF to replace the manual shown on the landing page.
          </p>
          <form onSubmit={onUploadManual} className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1 sm:col-span-2">
              <Label>Manual file (PDF)</Label>
              <Input
                id="manual-file"
                type="file"
                accept="application/pdf"
                onChange={(e) => setManualFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="space-y-1">
              <Label>Version (optional)</Label>
              <Input
                value={manualVersion}
                onChange={(e) => setManualVersion(e.target.value)}
                placeholder="e.g. 1.1"
              />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Button type="submit" disabled={manualUploading} className="w-full">
                {manualUploading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                {manualUploading ? "Uploading…" : "Publish manual"}
              </Button>
              {manualUploading && <Progress value={manualProgress} />}
            </div>
          </form>

          {manuals.length > 0 && (
            <div className="mt-5">
              <h3 className="text-xs font-medium uppercase text-muted-foreground mb-2">
                History
              </h3>
              <ul className="divide-y divide-border/60">
                {manuals.map((m) => (
                  <li
                    key={m.id}
                    className="py-2 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate flex items-center gap-2">
                        {m.file_name}
                        {m.is_active && (
                          <span className="text-[10px] uppercase tracking-wide rounded-full bg-primary/15 text-primary px-2 py-0.5">
                            Live
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {m.version ? `v${m.version} · ` : ""}
                        {new Date(m.created_at).toLocaleString()}
                      </div>
                    </div>
                    <a
                      href={m.file_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Download"
                    >
                      <Button variant="ghost" size="icon">
                        <Download className="w-4 h-4" />
                      </Button>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
