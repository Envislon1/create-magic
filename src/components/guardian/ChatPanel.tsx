import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Send, Loader2, Sparkles, Check, CheckCheck, Trash2, X } from "lucide-react";
import { DialogClose } from "@/components/ui/dialog";
import { useServerFn } from "@tanstack/react-start";
import { chatWithGuardianAi } from "@/lib/guardian-ai.functions";
import { showChatNotification } from "@/lib/notifications";
import { useSpeech } from "@/hooks/use-speech";

// Matches AI directives — these are processed server/device-side and must
// be stripped from any text shown or spoken in chat.
const DIRECTIVE_RE = /\[\[\s*(?:music|song|med_add|med_update|med_remove)\s*:[^\]]*\]\]/gi;

function stripMusic(content: string): string {
  return content.replace(DIRECTIVE_RE, "").trim();
}


type Msg = {
  id: string;
  role: string;
  content: string;
  created_at: string;
  user_id: string;
  recipient_id: string | null;
  conversation: string;
};

type Props = {
  userId: string;
  /** "guardian_ai" or "care" */
  conversation: "guardian_ai" | "care";
  /** for care chat: the other party */
  peerId?: string | null;
  peerName?: string;
  /** for guardian_ai: current mode */
  mode?: string;
  fullScreen?: boolean;
  soundEnabled?: boolean;
  preferredVoice?: string;
  speakerVolume?: number;
};

export function ChatPanel({
  userId,
  conversation,
  peerId,
  peerName,
  mode,
  fullScreen = false,
  soundEnabled = true,
  preferredVoice = "female",
  speakerVolume = 70,
}: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [clearing, setClearing] = useState(false);
  const askAi = useServerFn(chatWithGuardianAi);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { speak, cancel } = useSpeech();
  const prefsRef = useRef({ soundEnabled, preferredVoice, speakerVolume });
  prefsRef.current = { soundEnabled, preferredVoice, speakerVolume };

  useEffect(() => () => cancel(), [cancel]);


  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`chat-${conversation}-${userId}-${peerId ?? "ai"}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const m = payload.new as Msg;
          if (m.conversation !== conversation) return;
          if (conversation === "guardian_ai") {
            if (m.user_id !== userId) return;
          } else {
            const pair =
              (m.user_id === userId && m.recipient_id === peerId) ||
              (m.user_id === peerId && m.recipient_id === userId);
            if (!pair) return;
          }
          setMessages((p) => (p.some((x) => x.id === m.id) ? p : [...p, m]));
          if (m.user_id !== userId) {
            const title = conversation === "guardian_ai" ? "Mind Buddy AI" : peerName || "New message";
            void showChatNotification(title, stripMusic(m.content).slice(0, 140), m.id);
          }
          // Speak the Mind Buddy AI's reply. Any [[music:<id>]] directive is
          // stripped here and handled by the hardware via device sync.
          if (conversation === "guardian_ai" && m.role === "assistant") {
            const text = stripMusic(m.content);
            const { soundEnabled: en, preferredVoice: pv, speakerVolume: vol } = prefsRef.current;
            speak(text, { enabled: en, voice: pv, volume: vol });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, conversation, peerId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function load() {
    let q = supabase
      .from("chat_messages")
      .select("*")
      .eq("conversation", conversation)
      .order("created_at", { ascending: true })
      .limit(100);
    if (conversation === "guardian_ai") {
      q = q.eq("user_id", userId);
    } else if (peerId) {
      q = q.or(
        `and(user_id.eq.${userId},recipient_id.eq.${peerId}),and(user_id.eq.${peerId},recipient_id.eq.${userId})`,
      );
    }
    const { data } = await q;
    setMessages((data || []) as Msg[]);
  }

  async function clearChats() {
    if (clearing) return;
    const ok = window.confirm(
      conversation === "guardian_ai"
        ? "Delete all your Mind Buddy AI messages? This cannot be undone."
        : "Delete all your messages in this chat? This cannot be undone.",
    );
    if (!ok) return;
    setClearing(true);
    try {
      // For Mind Buddy AI: delete the user's own AI thread.
      // For care chat: delete every message in this pair (both sides) — the
      // RLS DELETE policy allows either participant (sender or recipient) to
      // remove care messages, so clearing wipes the whole conversation.
      let q = supabase.from("chat_messages").delete();
      if (conversation === "guardian_ai") {
        q = q.eq("conversation", "guardian_ai").eq("user_id", userId);
      } else if (peerId) {
        q = q
          .eq("conversation", "care")
          .or(
            `and(user_id.eq.${userId},recipient_id.eq.${peerId}),and(user_id.eq.${peerId},recipient_id.eq.${userId})`,
          );
      } else {
        q = q.eq("conversation", "care").eq("user_id", userId);
      }
      const { error } = await q;
      if (error) throw error;
      setMessages([]);
      toast.success("Chat cleared");
    } catch (e: any) {
      toast.error(e.message || "Could not clear chat");
    } finally {
      setClearing(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    try {
      if (conversation === "guardian_ai") {
        const history = messages.slice(-12).map((m) => ({
          role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: m.content,
        }));
        await askAi({ data: { message: text, history, mode } });
      } else {
        if (!peerId) {
          toast.error("No one to chat with yet.");
          return;
        }
        const { error } = await supabase.from("chat_messages").insert({
          user_id: userId,
          recipient_id: peerId,
          role: "user",
          content: text,
          conversation: "care",
        });
        if (error) throw error;
      }
    } catch (e: any) {
      toast.error(e.message || "Could not send");
    } finally {
      setSending(false);
    }
  }

  const lastPeerTs = messages
    .filter((x) => x.user_id !== userId)
    .reduce((acc, x) => Math.max(acc, new Date(x.created_at).getTime()), 0);

  const chatBackground =
    conversation === "care"
      ? "bg-[linear-gradient(rgba(11,20,26,0.94),rgba(11,20,26,0.94)),url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"160\" height=\"160\" viewBox=\"0 0 160 160\"><g fill=\"none\" stroke=\"rgba(255,255,255,0.06)\" stroke-width=\"2\"><circle cx=\"18\" cy=\"18\" r=\"8\"/><rect x=\"58\" y=\"14\" width=\"18\" height=\"12\" rx=\"3\"/><path d=\"M103 19h20\"/><path d=\"M15 61h18v18H15z\"/><path d=\"M53 55c8 0 14 6 14 14s-6 14-14 14-14-6-14-14 6-14 14-14Z\"/><path d=\"M108 57l14 14-14 14-14-14z\"/><path d=\"M21 112c10 0 18 8 18 18\"/><path d=\"M61 108h18v18H61z\"/><circle cx=\"116\" cy=\"118\" r=\"10\"/></g></svg>')] bg-[length:160px_160px]"
      : "bg-[#0b141a]";

  return (
    <Card className={`p-0 overflow-hidden flex flex-col ${fullScreen ? "h-[calc(100dvh-7rem)]" : "h-[480px]"}`}>
      <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2 bg-muted/30">
        {conversation === "guardian_ai" ? (
          <>
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="font-medium text-sm">Mind Buddy AI</span>
            <span className="text-xs text-muted-foreground ml-auto hidden sm:inline">Private & supportive</span>
          </>
        ) : (
          <>
            <span className="font-medium text-sm">{peerName || "Care chat"}</span>
          </>
        )}
        <div className={`flex items-center gap-1 ${conversation === "guardian_ai" ? "" : "ml-auto"}`}>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => void clearChats()}
            disabled={clearing || messages.length === 0}
            aria-label="Clear chats"
            title="Clear chats"
          >
            {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </Button>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Close chat"
              title="Close"
            >
              <X className="w-4 h-4" />
            </Button>
          </DialogClose>
        </div>
      </div>
      <div ref={scrollRef} className={`flex-1 overflow-y-auto px-3 py-3 space-y-1.5 ${chatBackground}`}>
        {messages.length === 0 && (
          <p className="text-xs text-white/60 text-center py-8">
            {conversation === "guardian_ai"
              ? "Say hi — I'm here whenever you need to talk."
              : "No messages yet. Send the first one."}
          </p>
        )}
        {messages.map((m) => {
          const mine = conversation === "guardian_ai" ? m.role !== "assistant" : m.user_id === userId;
          const time = new Date(m.created_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
          const delivered = mine;
          const read = mine && lastPeerTs > new Date(m.created_at).getTime();

          return (
            <div key={m.id} className={`flex w-full ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[82%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                  mine
                    ? "bg-chat-user text-chat-user-foreground rounded-br-xs border border-white/10"
                    : "bg-chat-recipient text-chat-recipient-foreground rounded-bl-xs border border-white/10"
                }`}
              >
                <div className="whitespace-pre-wrap break-words leading-[1.35]">{stripMusic(m.content)}</div>
                <div className="mt-1 -mb-0.5 flex items-center justify-end gap-1">
                  <span className="text-[10px] text-white/60">{time}</span>
                  {mine &&
                    (read ? (
                      <CheckCheck className="h-3.5 w-3.5 text-sky-400" />
                    ) : delivered ? (
                      <CheckCheck className="h-3.5 w-3.5 text-white/60" />
                    ) : (
                      <Check className="h-3.5 w-3.5 text-white/60" />
                    ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-border/60 p-2 flex items-center gap-1.5">
        {/* Mobile-reachable clear + close so the user doesn't have to stretch
            to the top of the screen while typing. Hidden on sm+ where the
            header buttons are easy to reach. */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 sm:hidden"
          onClick={() => void clearChats()}
          disabled={clearing || messages.length === 0}
          aria-label="Clear chats"
          title="Clear chats"
        >
          {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </Button>
        <DialogClose asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 sm:hidden"
            aria-label="Close chat"
            title="Close"
          >
            <X className="w-4 h-4" />
          </Button>
        </DialogClose>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={conversation === "guardian_ai" ? "Tell me what's on your mind…" : "Type a message…"}
          disabled={sending}
        />
        <Button size="icon" onClick={() => void send()} disabled={sending || !input.trim()}>
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </Card>
  );
}