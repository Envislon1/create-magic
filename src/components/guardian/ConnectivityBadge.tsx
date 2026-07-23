import { Wifi, WifiOff } from "lucide-react";
import { type ConnectivityStatus, connectivityLabel } from "@/lib/connectivity";

export function ConnectivityBadge({ status }: { status: ConnectivityStatus }) {
  const color =
    status === "online"
      ? "text-[color:var(--online)]"
      : status === "idle"
      ? "text-amber-400"
      : "text-muted-foreground";
  const dot =
    status === "online"
      ? "bg-[color:var(--online)]"
      : status === "idle"
      ? "bg-amber-400"
      : "bg-muted-foreground";
  return (
    <div className={`inline-flex items-center gap-1.5 text-xs font-medium ${color}`}>
      <span className="relative inline-flex w-2 h-2">
        {status === "online" && (
          <span className={`absolute inset-0 rounded-full ${dot} animate-ping opacity-60`} />
        )}
        <span className={`relative inline-flex w-2 h-2 rounded-full ${dot}`} />
      </span>
      {status === "offline" ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
      <span>{connectivityLabel(status)}</span>
    </div>
  );
}