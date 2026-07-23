export type ConnectivityStatus = "online" | "idle" | "offline";

export function connectivityFrom(lastSeenAt: string | null | undefined): ConnectivityStatus {
  if (!lastSeenAt) return "offline";
  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  if (ageMs < 90_000) return "online"; // seen in last 90s
  if (ageMs < 10 * 60_000) return "idle"; // last 10 min
  return "offline";
}

export function connectivityLabel(s: ConnectivityStatus): string {
  return s === "online" ? "Live" : s === "idle" ? "Idle" : "Offline";
}