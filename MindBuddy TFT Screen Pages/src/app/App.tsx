import { useState } from "react";
import {
  Home,
  Brain,
  MessageCircle,
  Music,
  Bell,
  AlertTriangle,
  Settings,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Check,
  Plus,
  Mic,
  Send,
  Heart,
  Shield,
  Zap,
  Moon,
  Sun,
  Wind,
  RotateCcw,
  Wifi,
  Battery,
  Clock,
  PhoneCall,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  MessageSquare,
  Headphones,
  Inbox,
  Edit3,
  BookOpen,
  ChevronDown,
  Radio,
  Sliders,
} from "lucide-react";

// ─── Shared helpers ───────────────────────────────────────────────────────────

function StatusBar({ light = false }: { light?: boolean }) {
  const text = light ? "text-white/70" : "text-[#6b7a99]";
  return (
    <div className={`flex items-center justify-between px-3 pt-2 pb-1 ${text}`} style={{ fontFamily: "'DM Mono', monospace", fontSize: 9 }}>
      <span>09:41</span>
      <div className="flex items-center gap-1">
        <Wifi size={9} />
        <Battery size={9} />
      </div>
    </div>
  );
}

function NavBar({ onBack, title }: { onBack?: () => void; title: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-[#e8edf5]">
      {onBack && (
        <button onClick={onBack} className="text-[#6b7a99] hover:text-[#5eb8b0] transition-colors">
          <ChevronLeft size={16} />
        </button>
      )}
      <span className="font-semibold text-sm tracking-tight">{title}</span>
    </div>
  );
}

// ─── Radio Group ──────────────────────────────────────────────────────────────

function RadioGroup({
  options,
  value,
  onChange,
  color = "#5eb8b0",
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  color?: string;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className="flex-1 rounded-lg py-1.5 text-[9px] font-semibold transition-all"
            style={{
              background: active ? `${color}28` : "rgba(255,255,255,0.05)",
              border: `1px solid ${active ? color + "66" : "rgba(255,255,255,0.08)"}`,
              color: active ? color : "#6b7a99",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ─── Screen 1: Home ───────────────────────────────────────────────────────────

function HomeScreen({ navigate }: { navigate: (s: string) => void }) {
  return (
    <div className="flex flex-col h-full" style={{ background: "linear-gradient(160deg, #0f1729 0%, #0b0f1a 60%)" }}>
      <StatusBar />
      <div className="px-4 pt-1 pb-2">
        <p className="text-[9px] text-[#6b7a99] font-medium uppercase tracking-widest mb-0.5">Good evening</p>
        <h1 className="text-[20px] font-extrabold text-[#e8edf5] leading-tight">MindBuddy</h1>
        <p className="text-[9px] text-[#5eb8b0] mt-0.5">How are you feeling today?</p>
      </div>

      {/* mood strip */}
      <div className="flex gap-1.5 px-4 mb-3">
        {["😔", "😟", "😐", "🙂", "😊"].map((e, i) => (
          <button
            key={i}
            className="flex-1 flex flex-col items-center rounded-lg py-1.5 transition-all"
            style={{
              background: i === 3 ? "rgba(94,184,176,0.18)" : "rgba(255,255,255,0.04)",
              border: i === 3 ? "1px solid rgba(94,184,176,0.4)" : "1px solid transparent",
            }}
          >
            <span style={{ fontSize: 15 }}>{e}</span>
          </button>
        ))}
      </div>

      {/* main nav grid */}
      <div className="grid grid-cols-3 gap-2 px-4 flex-1">
        {[
          { icon: Brain, label: "Modes", screen: "modes", color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
          { icon: MessageCircle, label: "Chat", screen: "chat", color: "#5eb8b0", bg: "rgba(94,184,176,0.12)" },
          { icon: Music, label: "Music", screen: "music", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
          { icon: Bell, label: "Reminder", screen: "reminder", color: "#34d399", bg: "rgba(52,211,153,0.12)" },
          { icon: AlertTriangle, label: "SOS", screen: "sos", color: "#f87171", bg: "rgba(248,113,113,0.12)" },
          { icon: Settings, label: "Settings", screen: "settings", color: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
        ].map(({ icon: Icon, label, screen, color, bg }) => (
          <button
            key={screen}
            onClick={() => navigate(screen)}
            className="flex flex-col items-center justify-center gap-1.5 rounded-xl py-3 transition-all active:scale-95"
            style={{ background: bg, border: `1px solid ${color}22` }}
          >
            <Icon size={21} color={color} strokeWidth={1.8} />
            <span className="text-[10px] font-semibold" style={{ color }}>{label}</span>
          </button>
        ))}
      </div>

      {/* quote */}
      <div className="px-4 py-2 mx-4 mt-2 rounded-xl" style={{ background: "rgba(94,184,176,0.07)", border: "1px solid rgba(94,184,176,0.15)" }}>
        <p className="text-[8px] text-[#5eb8b0] italic leading-relaxed">"You don't have to control your thoughts — stop letting them control you."</p>
      </div>

      {/* phone bottom bar */}
      <div
        className="flex items-center justify-around px-2 py-2 mt-2"
        style={{ borderTop: "1px solid rgba(94,184,176,0.12)", background: "rgba(11,15,26,0.95)" }}
      >
        {[
          { icon: Phone, label: "Call", screen: "call", color: "#34d399" },
          { icon: MessageSquare, label: "SMS", screen: "sms", color: "#5eb8b0" },
          { icon: BookOpen, label: "Log", screen: "calllog", color: "#a78bfa" },
        ].map(({ icon: Icon, label, screen, color }) => (
          <button
            key={screen}
            onClick={() => navigate(screen)}
            className="flex flex-col items-center gap-0.5 px-4 py-1 rounded-xl transition-all active:scale-95"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            <Icon size={16} color={color} strokeWidth={1.8} />
            <span className="text-[8px] font-semibold" style={{ color }}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Screen 2: Mode Selection ─────────────────────────────────────────────────

const MODES = [
  { label: "Depression", icon: Moon, color: "#818cf8", desc: "Mood lifting support" },
  { label: "Anxiety", icon: Wind, color: "#5eb8b0", desc: "Calm your mind" },
  { label: "PTSD", icon: Shield, color: "#a78bfa", desc: "Safe space support" },
  { label: "ADHD", icon: Zap, color: "#f59e0b", desc: "Focus & structure" },
  { label: "Bipolar", icon: Sun, color: "#f472b6", desc: "Balance & stability" },
  { label: "Schizo.", icon: Brain, color: "#34d399", desc: "Grounding exercises" },
];

function ModeScreen({ navigate }: { navigate: (s: string) => void }) {
  const [active, setActive] = useState<number | null>(null);
  return (
    <div className="flex flex-col h-full bg-[#0b0f1a]">
      <StatusBar />
      <NavBar onBack={() => navigate("home")} title="Select Mode" />
      <p className="text-[9px] text-[#6b7a99] px-4 mb-3">Choose your support focus for this session</p>
      <div className="grid grid-cols-2 gap-2 px-4 flex-1">
        {MODES.map(({ label, icon: Icon, color, desc }, i) => (
          <button
            key={label}
            onClick={() => { setActive(i); setTimeout(() => navigate("chat"), 400); }}
            className="flex flex-col items-start gap-2 rounded-xl p-3 transition-all active:scale-95 text-left"
            style={{
              background: active === i ? `${color}22` : "rgba(255,255,255,0.04)",
              border: `1px solid ${active === i ? color + "66" : color + "22"}`,
            }}
          >
            <div className="rounded-lg p-1.5" style={{ background: `${color}22` }}>
              <Icon size={18} color={color} strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-[11px] font-bold text-[#e8edf5] leading-none mb-0.5">{label}</p>
              <p className="text-[9px] text-[#6b7a99] leading-tight">{desc}</p>
            </div>
          </button>
        ))}
      </div>
      <div className="px-4 py-3">
        <p className="text-[9px] text-center text-[#6b7a99]">Tap a mode to begin your session</p>
      </div>
    </div>
  );
}

// ─── Screen 3: Chat ───────────────────────────────────────────────────────────

const MESSAGES = [
  { from: "bot", text: "Hi! I'm MindBuddy. How are you feeling right now?" },
  { from: "user", text: "Feeling a bit anxious today..." },
  { from: "bot", text: "I hear you. Let's try a quick breathing exercise. Inhale 4, hold 4, exhale 6." },
  { from: "user", text: "Okay, that helped a little." },
  { from: "bot", text: "Great! You're doing wonderfully. Want to talk more about what's on your mind?" },
];

function ChatScreen({ navigate }: { navigate: (s: string) => void }) {
  const [input, setInput] = useState("");
  return (
    <div className="flex flex-col h-full bg-[#0b0f1a]">
      <StatusBar />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[rgba(94,184,176,0.1)]">
        <button onClick={() => navigate("home")} className="text-[#6b7a99]"><ChevronLeft size={16} /></button>
        <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5eb8b0,#a78bfa)" }}>
          <Brain size={14} color="white" />
        </div>
        <div>
          <p className="text-[11px] font-bold text-[#e8edf5] leading-none">MindBuddy</p>
          <p className="text-[8px] text-[#34d399]">● Anxiety Mode</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Mic size={14} className="text-[#6b7a99]" />
          <Heart size={14} className="text-[#6b7a99]" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2" style={{ scrollbarWidth: "none" }}>
        {MESSAGES.map((m, i) => (
          <div key={i} className={`flex ${m.from === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className="max-w-[80%] rounded-2xl px-3 py-2"
              style={{
                background: m.from === "user" ? "linear-gradient(135deg,#5eb8b0,#3b9e97)" : "rgba(255,255,255,0.06)",
                borderBottomRightRadius: m.from === "user" ? 4 : undefined,
                borderBottomLeftRadius: m.from === "bot" ? 4 : undefined,
              }}
            >
              <p className="text-[10px] leading-relaxed" style={{ color: m.from === "user" ? "#0b0f1a" : "#c8d3e8" }}>{m.text}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="px-3 py-2 flex gap-2 items-center" style={{ borderTop: "1px solid rgba(94,184,176,0.1)" }}>
        <div className="flex-1 rounded-full flex items-center px-3 py-1.5" style={{ background: "rgba(255,255,255,0.06)" }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Type a message..."
            className="bg-transparent flex-1 outline-none text-[10px] text-[#e8edf5] placeholder-[#6b7a99]"
          />
        </div>
        <button className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5eb8b0,#a78bfa)" }}>
          <Send size={12} color="white" />
        </button>
      </div>
    </div>
  );
}

// ─── Screen 4: Music Player ───────────────────────────────────────────────────

const TRACKS = [
  { title: "Ocean Waves", artist: "Nature Sounds", duration: "4:32", active: true },
  { title: "Rain Forest", artist: "Calm Collective", duration: "5:14", active: false },
  { title: "432Hz Healing", artist: "BinauralMind", duration: "8:00", active: false },
];

function MusicScreen({ navigate }: { navigate: (s: string) => void }) {
  const [playing, setPlaying] = useState(false);
  const [prog] = useState(38);
  return (
    <div className="flex flex-col h-full" style={{ background: "linear-gradient(180deg,#13102a 0%,#0b0f1a 100%)" }}>
      <StatusBar />
      <NavBar onBack={() => navigate("home")} title="Music" />
      <div className="flex justify-center mt-1 mb-3">
        <div className="w-28 h-28 rounded-2xl flex items-center justify-center relative overflow-hidden" style={{ background: "linear-gradient(135deg,#1e1540,#2d1b4e)" }}>
          <div className="absolute inset-0 opacity-30" style={{ background: "radial-gradient(circle at 30% 40%, #a78bfa 0%, transparent 60%)" }} />
          <Headphones size={40} color="#a78bfa" strokeWidth={1.5} />
        </div>
      </div>
      <div className="px-5 mb-3">
        <p className="text-[14px] font-bold text-[#e8edf5] text-center leading-tight">Ocean Waves</p>
        <p className="text-[10px] text-[#6b7a99] text-center mt-0.5">Nature Sounds</p>
      </div>
      <div className="px-5 mb-3">
        <div className="h-1 rounded-full bg-[rgba(255,255,255,0.1)] relative">
          <div className="h-full rounded-full" style={{ width: `${prog}%`, background: "linear-gradient(90deg,#5eb8b0,#a78bfa)" }} />
          <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-lg" style={{ left: `calc(${prog}% - 6px)` }} />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-[#6b7a99]" style={{ fontFamily: "DM Mono" }}>1:44</span>
          <span className="text-[9px] text-[#6b7a99]" style={{ fontFamily: "DM Mono" }}>4:32</span>
        </div>
      </div>
      <div className="flex items-center justify-center gap-6 mb-4">
        <button className="text-[#6b7a99]"><SkipBack size={18} strokeWidth={1.8} /></button>
        <button
          onClick={() => setPlaying(!playing)}
          className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
          style={{ background: "linear-gradient(135deg,#5eb8b0,#a78bfa)" }}
        >
          {playing ? <Pause size={20} color="white" strokeWidth={2} /> : <Play size={20} color="white" strokeWidth={2} />}
        </button>
        <button className="text-[#6b7a99]"><SkipForward size={18} strokeWidth={1.8} /></button>
      </div>
      <div className="px-4 flex-1">
        <p className="text-[9px] text-[#6b7a99] font-semibold uppercase tracking-widest mb-2">Up Next</p>
        {TRACKS.map((t, i) => (
          <div key={i} className="flex items-center gap-3 py-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[8px]" style={{ background: t.active ? "rgba(94,184,176,0.2)" : "rgba(255,255,255,0.05)" }}>
              {t.active ? <Play size={8} color="#5eb8b0" /> : <span className="text-[#6b7a99]">{i + 1}</span>}
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-semibold" style={{ color: t.active ? "#5eb8b0" : "#e8edf5" }}>{t.title}</p>
              <p className="text-[8px] text-[#6b7a99]">{t.artist}</p>
            </div>
            <span className="text-[9px] text-[#6b7a99]" style={{ fontFamily: "DM Mono" }}>{t.duration}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Screen 5: Reminder ───────────────────────────────────────────────────────

function ReminderScreen({ navigate }: { navigate: (s: string) => void }) {
  const [reminders, setReminders] = useState([
    { name: "Sertraline 50mg", time: "08:00", enabled: true },
    { name: "Alprazolam 0.5mg", time: "12:00", enabled: true },
    { name: "Melatonin 5mg", time: "21:00", enabled: false },
  ]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTime, setNewTime] = useState("09:00");

  const toggle = (i: number) =>
    setReminders(r => r.map((x, j) => j === i ? { ...x, enabled: !x.enabled } : x));

  const add = () => {
    if (!newName.trim()) return;
    setReminders(r => [...r, { name: newName.trim(), time: newTime, enabled: true }]);
    setNewName(""); setNewTime("09:00"); setAdding(false);
  };

  const remove = (i: number) => setReminders(r => r.filter((_, j) => j !== i));

  return (
    <div className="flex flex-col h-full bg-[#0b0f1a]">
      <StatusBar />
      <NavBar onBack={() => navigate("home")} title="Medication Reminders" />

      <div className="flex-1 overflow-y-auto px-4 space-y-2 pb-2" style={{ scrollbarWidth: "none" }}>
        {reminders.map((r, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-xl px-3 py-2.5"
            style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${r.enabled ? "rgba(52,211,153,0.25)" : "rgba(255,255,255,0.06)"}` }}
          >
            <Bell size={13} color={r.enabled ? "#34d399" : "#6b7a99"} />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-[#e8edf5] truncate">{r.name}</p>
              <p className="text-[9px] font-medium" style={{ fontFamily: "DM Mono", color: r.enabled ? "#5eb8b0" : "#6b7a99" }}>{r.time}</p>
            </div>
            {/* toggle */}
            <button onClick={() => toggle(i)} className="relative w-8 h-4 rounded-full flex-shrink-0 transition-colors" style={{ background: r.enabled ? "#34d399" : "rgba(255,255,255,0.12)" }}>
              <div className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all" style={{ left: r.enabled ? "calc(100% - 14px)" : "2px" }} />
            </button>
            <button onClick={() => remove(i)} className="ml-1 text-[#6b7a99] hover:text-[#f87171] transition-colors">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
        ))}

        {/* add form */}
        {adding ? (
          <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(94,184,176,0.07)", border: "1px solid rgba(94,184,176,0.25)" }}>
            <p className="text-[9px] font-semibold text-[#5eb8b0] uppercase tracking-wide">New Reminder</p>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Medication name & dose"
              className="w-full bg-transparent border-b outline-none text-[10px] text-[#e8edf5] placeholder-[#6b7a99] pb-1"
              style={{ borderColor: "rgba(94,184,176,0.3)" }}
            />
            <div className="flex items-center gap-2">
              <Clock size={11} color="#6b7a99" />
              <input
                type="time"
                value={newTime}
                onChange={e => setNewTime(e.target.value)}
                className="bg-transparent outline-none text-[10px] text-[#e8edf5] flex-1"
                style={{ fontFamily: "DM Mono", colorScheme: "dark" }}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={add} className="flex-1 rounded-lg py-1.5 text-[10px] font-semibold text-[#0b0f1a]" style={{ background: "#34d399" }}>Save</button>
              <button onClick={() => setAdding(false)} className="flex-1 rounded-lg py-1.5 text-[10px] font-semibold text-[#6b7a99]" style={{ background: "rgba(255,255,255,0.06)" }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full rounded-xl py-2.5 text-[11px] font-semibold text-[#0b0f1a] flex items-center justify-center gap-1.5"
            style={{ background: "linear-gradient(135deg,#5eb8b0,#34d399)" }}
          >
            <Plus size={13} />
            Add Reminder
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Screen 6: SOS ────────────────────────────────────────────────────────────

type SosView = "main" | "dialer" | "contacts";

interface SosContact {
  name: string;
  number: string;
}

const SOS_DIAL_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

const DEFAULT_SOS_CONTACTS: SosContact[] = [
  { name: "Dr. Patel", number: "+1 555-0102" },
  { name: "Mom", number: "+1 555-0134" },
];

function SOSScreen({ navigate }: { navigate: (s: string) => void }) {
  const [view, setView] = useState<SosView>("main");

  // contacts: max 5, one active at a time
  const [contacts, setContacts] = useState<SosContact[]>(DEFAULT_SOS_CONTACTS);
  const [activeIdx, setActiveIdx] = useState<number>(0); // which contact is "armed"

  // dialer state
  const [dialNum, setDialNum] = useState("");
  const [saveName, setSaveName] = useState("");
  const [showSave, setShowSave] = useState(false);

  // contact edit
  const [addingContact, setAddingContact] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNum, setNewNum] = useState("");

  const activeContact = contacts[activeIdx] ?? null;

  const pressKey = (k: string) => setDialNum(n => (n + k).slice(0, 14));

  const saveDialedContact = () => {
    if (!saveName.trim() || !dialNum) return;
    if (contacts.length < 5) {
      const next = [...contacts, { name: saveName.trim(), number: dialNum }];
      setContacts(next);
      setActiveIdx(next.length - 1);
    }
    setSaveName(""); setShowSave(false); setDialNum(""); setView("main");
  };

  const addContact = () => {
    if (!newName.trim() || !newNum.trim() || contacts.length >= 5) return;
    const next = [...contacts, { name: newName.trim(), number: newNum.trim() }];
    setContacts(next);
    setActiveIdx(next.length - 1);
    setNewName(""); setNewNum(""); setAddingContact(false);
  };

  const removeContact = (i: number) => {
    const next = contacts.filter((_, j) => j !== i);
    setContacts(next);
    setActiveIdx(Math.min(activeIdx, next.length - 1));
  };

  // ── Main view ──────────────────────────────────────────────────────────────
  if (view === "main") return (
    <div className="flex flex-col h-full" style={{ background: "linear-gradient(160deg,#1a0a0a 0%,#0b0f1a 100%)" }}>
      <StatusBar />
      <div className="flex items-center justify-between px-3 py-1.5">
        <button onClick={() => navigate("home")} className="text-[#6b7a99]"><ChevronLeft size={16} /></button>
        <span className="text-[12px] font-bold text-[#f87171]">SOS Crisis Support</span>
        <span />
      </div>

      {/* CALL HELP button */}
      <div className="flex flex-col items-center py-3 gap-1.5">
        <div className="relative">
          <div className="absolute inset-0 rounded-full animate-ping opacity-15" style={{ background: "#ef4444" }} />
          <button
            className="w-20 h-20 rounded-full flex flex-col items-center justify-center gap-1 shadow-2xl relative"
            style={{ background: "linear-gradient(135deg,#ef4444,#b91c1c)", border: "3px solid rgba(248,113,113,0.35)" }}
          >
            <PhoneCall size={22} color="white" strokeWidth={2} />
            <span className="text-[8px] text-white font-bold uppercase tracking-wide">Call Help</span>
          </button>
        </div>
        {activeContact ? (
          <p className="text-[9px] font-semibold" style={{ color: "#f87171" }}>
            → {activeContact.name} · <span style={{ fontFamily: "DM Mono" }}>{activeContact.number}</span>
          </p>
        ) : (
          <p className="text-[9px] text-[#6b7a99]">No contact selected</p>
        )}
      </div>

      {/* action row */}
      <div className="flex gap-2 px-4 mb-3">
        <button
          onClick={() => setView("dialer")}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-[10px] font-semibold transition-all"
          style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", color: "#f87171" }}
        >
          <Phone size={12} />
          Dial Pad
        </button>
        <button
          onClick={() => setView("contacts")}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-[10px] font-semibold transition-all"
          style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.25)", color: "#a78bfa" }}
        >
          <BookOpen size={12} />
          Contacts ({contacts.length}/5)
        </button>
      </div>

      {/* saved contacts quick-list */}
      {contacts.length > 0 && (
        <div className="px-4 space-y-1.5 flex-1">
          <p className="text-[8px] text-[#6b7a99] font-semibold uppercase tracking-widest mb-1">Emergency Contacts</p>
          {contacts.map((c, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-xl px-3 py-2"
              style={{
                background: activeIdx === i ? "rgba(248,113,113,0.1)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${activeIdx === i ? "rgba(248,113,113,0.35)" : "rgba(255,255,255,0.06)"}`,
              }}
            >
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0" style={{ background: activeIdx === i ? "rgba(248,113,113,0.25)" : "rgba(255,255,255,0.08)", color: activeIdx === i ? "#f87171" : "#6b7a99" }}>
                {c.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold leading-none" style={{ color: activeIdx === i ? "#f87171" : "#e8edf5" }}>{c.name}</p>
                <p className="text-[8px] text-[#6b7a99] mt-0.5" style={{ fontFamily: "DM Mono" }}>{c.number}</p>
              </div>
              {/* radio-style toggle — only one on */}
              <button
                onClick={() => setActiveIdx(i)}
                className="relative w-9 h-5 rounded-full flex-shrink-0 transition-colors"
                style={{ background: activeIdx === i ? "#ef4444" : "rgba(255,255,255,0.1)" }}
              >
                <div
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                  style={{ left: activeIdx === i ? "calc(100% - 18px)" : "2px" }}
                />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-center text-[8px] text-[#6b7a99] px-6 py-2">
        Immediate danger? Also call <span className="text-[#f87171] font-semibold">911</span>
      </p>
    </div>
  );

  // ── Dial pad view ──────────────────────────────────────────────────────────
  if (view === "dialer") return (
    <div className="flex flex-col h-full" style={{ background: "linear-gradient(160deg,#1a0a0a 0%,#0b0f1a 100%)" }}>
      <StatusBar />
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button onClick={() => { setView("main"); setDialNum(""); setShowSave(false); }} className="text-[#6b7a99]">
          <ChevronLeft size={16} />
        </button>
        <span className="text-[12px] font-bold text-[#f87171]">SOS Dial Pad</span>
      </div>

      {/* number display */}
      <div className="flex items-center justify-center px-5 py-2 gap-2">
        <p
          className="flex-1 text-center text-[20px] font-bold text-[#e8edf5] tracking-widest"
          style={{ fontFamily: "DM Mono", minHeight: 30 }}
        >
          {dialNum || <span className="text-[#3a4560] text-[14px]">Enter number</span>}
        </p>
        {dialNum.length > 0 && (
          <button onClick={() => setDialNum(n => n.slice(0, -1))} className="text-[#6b7a99]">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 2.5L1 7l4 4.5M2 7h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* keypad */}
      <div className="grid grid-cols-3 gap-1.5 px-5 flex-1">
        {SOS_DIAL_KEYS.map(k => (
          <button
            key={k}
            onClick={() => pressKey(k)}
            className="rounded-xl flex items-center justify-center font-bold text-[16px] text-[#e8edf5] transition-all active:scale-95"
            style={{ background: "rgba(255,255,255,0.06)", fontFamily: "DM Mono" }}
          >
            {k}
          </button>
        ))}
      </div>

      {/* save + call row */}
      <div className="px-5 py-3 space-y-2">
        {showSave ? (
          <div className="flex gap-2">
            <input
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              placeholder="Contact name"
              className="flex-1 rounded-lg px-3 py-1.5 bg-transparent outline-none text-[10px] text-[#e8edf5] placeholder-[#3a4560]"
              style={{ border: "1px solid rgba(167,139,250,0.4)" }}
            />
            <button onClick={saveDialedContact} className="px-3 rounded-lg text-[10px] font-bold text-[#0b0f1a]" style={{ background: "#a78bfa" }}>Save</button>
            <button onClick={() => setShowSave(false)} className="px-2 rounded-lg text-[10px] text-[#6b7a99]" style={{ background: "rgba(255,255,255,0.06)" }}>✕</button>
          </div>
        ) : (
          <button
            onClick={() => setShowSave(true)}
            disabled={!dialNum || contacts.length >= 5}
            className="w-full rounded-xl py-2 text-[10px] font-semibold transition-all"
            style={{ background: dialNum && contacts.length < 5 ? "rgba(167,139,250,0.15)" : "rgba(255,255,255,0.04)", color: dialNum && contacts.length < 5 ? "#a78bfa" : "#3a4560", border: `1px solid ${dialNum && contacts.length < 5 ? "rgba(167,139,250,0.3)" : "rgba(255,255,255,0.06)"}` }}
          >
            {contacts.length >= 5 ? "Contact list full (5/5)" : "Save to SOS Contacts"}
          </button>
        )}
        <button
          disabled={!dialNum}
          className="w-full rounded-xl py-2.5 text-[11px] font-bold flex items-center justify-center gap-2 transition-all"
          style={{ background: dialNum ? "linear-gradient(135deg,#ef4444,#b91c1c)" : "rgba(255,255,255,0.05)", color: dialNum ? "white" : "#3a4560" }}
        >
          <PhoneCall size={14} />
          Call {dialNum || "—"}
        </button>
      </div>
    </div>
  );

  // ── Contacts manager view ──────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full" style={{ background: "linear-gradient(160deg,#1a0a0a 0%,#0b0f1a 100%)" }}>
      <StatusBar />
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button onClick={() => setView("main")} className="text-[#6b7a99]"><ChevronLeft size={16} /></button>
        <span className="text-[12px] font-bold text-[#f87171]">SOS Contacts</span>
        <span className="ml-auto text-[9px] text-[#6b7a99]" style={{ fontFamily: "DM Mono" }}>{contacts.length}/5</span>
      </div>

      <p className="text-[8px] text-[#6b7a99] px-4 mb-3 leading-relaxed">Toggle <span className="text-[#f87171]">one</span> contact — it will be dialed when you press CALL HELP.</p>

      <div className="flex-1 overflow-y-auto px-4 space-y-2" style={{ scrollbarWidth: "none" }}>
        {contacts.map((c, i) => (
          <div
            key={i}
            className="rounded-xl px-3 py-2.5"
            style={{ background: activeIdx === i ? "rgba(248,113,113,0.09)" : "rgba(255,255,255,0.04)", border: `1px solid ${activeIdx === i ? "rgba(248,113,113,0.3)" : "rgba(255,255,255,0.06)"}` }}
          >
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: activeIdx === i ? "rgba(248,113,113,0.2)" : "rgba(255,255,255,0.08)", color: activeIdx === i ? "#f87171" : "#94a3b8" }}>
                {c.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold" style={{ color: activeIdx === i ? "#f87171" : "#e8edf5" }}>{c.name}</p>
                <p className="text-[8px] text-[#6b7a99]" style={{ fontFamily: "DM Mono" }}>{c.number}</p>
              </div>
              {/* radio toggle */}
              <button
                onClick={() => setActiveIdx(i)}
                className="relative w-9 h-5 rounded-full flex-shrink-0 transition-all"
                style={{ background: activeIdx === i ? "#ef4444" : "rgba(255,255,255,0.1)" }}
              >
                <div
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                  style={{ left: activeIdx === i ? "calc(100% - 18px)" : "2px" }}
                />
              </button>
              <button onClick={() => removeContact(i)} className="text-[#6b7a99] hover:text-[#f87171] transition-colors ml-1">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>
          </div>
        ))}

        {/* add contact form */}
        {contacts.length < 5 && (
          addingContact ? (
            <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.25)" }}>
              <p className="text-[9px] font-semibold text-[#a78bfa] uppercase tracking-wide">New Contact</p>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Name"
                className="w-full bg-transparent border-b outline-none text-[10px] text-[#e8edf5] placeholder-[#6b7a99] pb-1"
                style={{ borderColor: "rgba(167,139,250,0.3)" }}
              />
              <input
                value={newNum}
                onChange={e => setNewNum(e.target.value)}
                placeholder="Phone number"
                className="w-full bg-transparent border-b outline-none text-[10px] text-[#e8edf5] placeholder-[#6b7a99] pb-1"
                style={{ borderColor: "rgba(167,139,250,0.3)", fontFamily: "DM Mono" }}
              />
              <div className="flex gap-2 pt-1">
                <button onClick={addContact} className="flex-1 rounded-lg py-1.5 text-[10px] font-semibold text-[#0b0f1a]" style={{ background: "#a78bfa" }}>Save</button>
                <button onClick={() => { setAddingContact(false); setNewName(""); setNewNum(""); }} className="flex-1 rounded-lg py-1.5 text-[10px] font-semibold text-[#6b7a99]" style={{ background: "rgba(255,255,255,0.06)" }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingContact(true)}
              className="w-full rounded-xl py-2.5 text-[10px] font-semibold flex items-center justify-center gap-1.5 transition-all"
              style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.25)", color: "#a78bfa" }}
            >
              <Plus size={12} />
              Add Contact
            </button>
          )
        )}

        {contacts.length >= 5 && (
          <p className="text-center text-[8px] text-[#6b7a99] py-1">Maximum 5 emergency contacts reached.</p>
        )}
      </div>
    </div>
  );
}

// ─── Screen 7: Settings ───────────────────────────────────────────────────────

function SettingsScreen({ navigate }: { navigate: (s: string) => void }) {
  const [pipeline, setPipeline] = useState("Auto");
  const [localVoice, setLocalVoice] = useState("Kokoro TTS");
  const [voiceGender, setVoiceGender] = useState("Female");
  const [volume, setVolume] = useState(72);
  const [notifMeds, setNotifMeds] = useState(true);
  const [notifCheckin, setNotifCheckin] = useState(true);
  const [notifCrisis, setNotifCrisis] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [soundFx, setSoundFx] = useState(true);
  const [wifi, setWifi] = useState(false);

  const Toggle = ({ on, onToggle }: { on: boolean; onToggle: () => void }) => (
    <button onClick={onToggle} className="relative w-9 h-5 rounded-full flex-shrink-0 transition-colors" style={{ background: on ? "#5eb8b0" : "rgba(255,255,255,0.12)" }}>
      <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: on ? "calc(100% - 18px)" : "2px" }} />
    </button>
  );

  const SettingRow = ({ label, icon: Icon, children }: { label: string; icon: any; children: React.ReactNode }) => (
    <div className="flex items-center gap-3 px-3 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.03)" }}>
      <Icon size={13} color="#6b7a99" />
      <span className="flex-1 text-[10px] text-[#c8d3e8]">{label}</span>
      {children}
    </div>
  );

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div>
      <p className="text-[9px] text-[#6b7a99] font-semibold uppercase tracking-widest mb-2 px-1">{title}</p>
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        {children}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-[#0b0f1a]">
      <StatusBar />
      <NavBar onBack={() => navigate("home")} title="Settings" />
      <div className="flex-1 overflow-y-auto px-4 space-y-4 pb-4" style={{ scrollbarWidth: "none" }}>

        {/* Pipeline */}
        <Section title="Pipeline">
          <div className="px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="flex items-center gap-2 mb-2">
              <Wifi size={13} color="#6b7a99" />
              <span className="text-[10px] text-[#c8d3e8]">Connection Mode</span>
            </div>
            <RadioGroup options={["Auto", "Online", "Offline"]} value={pipeline} onChange={setPipeline} color="#5eb8b0" />
          </div>
        </Section>

        {/* Voice Engine */}
        <Section title="Voice Engine">
          <div className="px-3 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.03)" }}>
            <div className="flex items-center gap-2 mb-2">
              <Mic size={13} color="#6b7a99" />
              <span className="text-[10px] text-[#c8d3e8]">Local TTS Engine</span>
            </div>
            <RadioGroup options={["Kokoro TTS", "Piper TTS"]} value={localVoice} onChange={setLocalVoice} color="#a78bfa" />
          </div>
          <div className="px-3 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.03)" }}>
            <div className="flex items-center gap-2 mb-2">
              <Radio size={13} color="#6b7a99" />
              <span className="text-[10px] text-[#c8d3e8]">Voice Gender</span>
            </div>
            <RadioGroup options={["Male", "Female"]} value={voiceGender} onChange={setVoiceGender} color="#f472b6" />
          </div>
          {/* Volume slider */}
          <div className="px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="flex items-center gap-2 mb-2">
              <Volume2 size={13} color="#6b7a99" />
              <span className="text-[10px] text-[#c8d3e8] flex-1">Volume</span>
              <span className="text-[9px] text-[#5eb8b0]" style={{ fontFamily: "DM Mono" }}>{volume}%</span>
            </div>
            <div className="relative h-5 flex items-center">
              <div className="absolute inset-x-0 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }} />
              <div className="absolute left-0 h-1 rounded-full" style={{ width: `${volume}%`, background: "linear-gradient(90deg,#5eb8b0,#a78bfa)" }} />
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={e => setVolume(Number(e.target.value))}
                className="absolute inset-x-0 opacity-0 cursor-pointer h-5"
                style={{ WebkitAppearance: "none" }}
              />
              <div className="absolute w-3.5 h-3.5 rounded-full bg-white shadow-lg pointer-events-none" style={{ left: `calc(${volume}% - 7px)` }} />
            </div>
          </div>
        </Section>

        {/* Notifications */}
        <Section title="Notifications">
          <SettingRow label="Medication Reminders" icon={Bell}><Toggle on={notifMeds} onToggle={() => setNotifMeds(!notifMeds)} /></SettingRow>
          <SettingRow label="Daily Check-in" icon={Clock}><Toggle on={notifCheckin} onToggle={() => setNotifCheckin(!notifCheckin)} /></SettingRow>
          <SettingRow label="Crisis Alerts" icon={AlertTriangle}><Toggle on={notifCrisis} onToggle={() => setNotifCrisis(!notifCrisis)} /></SettingRow>
        </Section>

        {/* Appearance */}
        <Section title="Appearance">
          <SettingRow label="Dark Mode" icon={Moon}><Toggle on={darkMode} onToggle={() => setDarkMode(!darkMode)} /></SettingRow>
          <SettingRow label="Reduced Motion" icon={RotateCcw}><Toggle on={reducedMotion} onToggle={() => setReducedMotion(!reducedMotion)} /></SettingRow>
        </Section>

        {/* Device */}
        <Section title="Device">
          <SettingRow label="Sound Effects" icon={Volume2}><Toggle on={soundFx} onToggle={() => setSoundFx(!soundFx)} /></SettingRow>
          <SettingRow label="Wi-Fi Sync" icon={Wifi}><Toggle on={wifi} onToggle={() => setWifi(!wifi)} /></SettingRow>
        </Section>

        {/* About */}
        <Section title="About">
          <div className="px-3 py-3" style={{ background: "rgba(255,255,255,0.03)" }}>
            <p className="text-[10px] font-bold text-[#e8edf5]">MindBuddy v1.0.0</p>
            <p className="text-[8px] text-[#6b7a99] mt-0.5">ESP32 · ST7789 TFT · SD Card Build</p>
            <p className="text-[8px] text-[#5eb8b0] mt-1">Firmware up to date ✓</p>
          </div>
        </Section>
      </div>
    </div>
  );
}

// ─── Screen 8: Call Dialer ────────────────────────────────────────────────────

const DIAL_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

function CallScreen({ navigate }: { navigate: (s: string) => void }) {
  const [num, setNum] = useState("");
  const press = (k: string) => setNum(n => (n + k).slice(0, 12));
  return (
    <div className="flex flex-col h-full bg-[#0b0f1a]">
      <StatusBar />
      <NavBar onBack={() => navigate("home")} title="Call" />

      {/* display */}
      <div className="flex items-center justify-center py-3 px-4">
        <div className="flex-1 text-center">
          <p className="text-[22px] font-bold text-[#e8edf5] tracking-widest" style={{ fontFamily: "DM Mono", minHeight: 34 }}>
            {num || <span className="text-[#3a4560]">Enter number</span>}
          </p>
        </div>
        {num.length > 0 && (
          <button onClick={() => setNum(n => n.slice(0, -1))} className="text-[#6b7a99] ml-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3L1 8l5 5M2 8h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        )}
      </div>

      {/* keypad */}
      <div className="grid grid-cols-3 gap-2 px-6 flex-1">
        {DIAL_KEYS.map(k => (
          <button
            key={k}
            onClick={() => press(k)}
            className="rounded-xl py-3 flex items-center justify-center font-bold text-[16px] text-[#e8edf5] transition-all active:scale-95"
            style={{ background: "rgba(255,255,255,0.06)", fontFamily: "DM Mono" }}
          >
            {k}
          </button>
        ))}
      </div>

      {/* call button */}
      <div className="flex justify-center py-4">
        <button className="w-14 h-14 rounded-full flex items-center justify-center shadow-xl" style={{ background: "linear-gradient(135deg,#34d399,#059669)" }}>
          <Phone size={22} color="white" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

// ─── Screen 9: SMS ────────────────────────────────────────────────────────────

type SmsTab = "inbox" | "outbox" | "compose";

const INBOX_MSGS = [
  { from: "Dr. Patel", preview: "Your next appointment is on Friday at 10am.", time: "09:15", unread: true },
  { from: "Mom", preview: "Just checking in! Hope you are feeling better.", time: "Yesterday", unread: false },
  { from: "Crisis Line", preview: "You're not alone. Text HOME anytime.", time: "Mon", unread: false },
];

const OUTBOX_MSGS = [
  { to: "Dr. Patel", preview: "Thank you, I'll be there!", time: "09:20" },
  { to: "Mom", preview: "Doing much better, thanks!", time: "Yesterday" },
];

function SMSScreen({ navigate }: { navigate: (s: string) => void }) {
  const [tab, setTab] = useState<SmsTab>("inbox");
  const [body, setBody] = useState("");
  const [to, setTo] = useState("");

  return (
    <div className="flex flex-col h-full bg-[#0b0f1a]">
      <StatusBar />
      <NavBar onBack={() => navigate("home")} title="Messages" />

      {/* tabs */}
      <div className="flex px-4 gap-1.5 mb-3">
        {(["inbox", "outbox", "compose"] as SmsTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 rounded-lg py-1.5 text-[9px] font-semibold capitalize transition-all"
            style={{
              background: tab === t ? "rgba(94,184,176,0.2)" : "rgba(255,255,255,0.05)",
              color: tab === t ? "#5eb8b0" : "#6b7a99",
              border: `1px solid ${tab === t ? "rgba(94,184,176,0.4)" : "rgba(255,255,255,0.08)"}`,
            }}
          >
            {t === "inbox" ? "Inbox" : t === "outbox" ? "Outbox" : "Compose"}
          </button>
        ))}
      </div>

      {tab === "inbox" && (
        <div className="flex-1 overflow-y-auto px-4 space-y-2" style={{ scrollbarWidth: "none" }}>
          {INBOX_MSGS.map((m, i) => (
            <div key={i} className="rounded-xl px-3 py-2.5 flex gap-3" style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${m.unread ? "rgba(94,184,176,0.25)" : "rgba(255,255,255,0.06)"}` }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold" style={{ background: "rgba(94,184,176,0.15)", color: "#5eb8b0" }}>
                {m.from[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold" style={{ color: m.unread ? "#e8edf5" : "#a0aec0" }}>{m.from}</p>
                  <span className="text-[8px] text-[#6b7a99]" style={{ fontFamily: "DM Mono" }}>{m.time}</span>
                </div>
                <p className="text-[9px] text-[#6b7a99] truncate mt-0.5">{m.preview}</p>
              </div>
              {m.unread && <div className="w-2 h-2 rounded-full bg-[#5eb8b0] flex-shrink-0 mt-1" />}
            </div>
          ))}
        </div>
      )}

      {tab === "outbox" && (
        <div className="flex-1 overflow-y-auto px-4 space-y-2" style={{ scrollbarWidth: "none" }}>
          {OUTBOX_MSGS.map((m, i) => (
            <div key={i} className="rounded-xl px-3 py-2.5 flex gap-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold" style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa" }}>
                {m.to[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-[#e8edf5]">To: {m.to}</p>
                  <span className="text-[8px] text-[#6b7a99]" style={{ fontFamily: "DM Mono" }}>{m.time}</span>
                </div>
                <p className="text-[9px] text-[#6b7a99] truncate mt-0.5">{m.preview}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "compose" && (
        <div className="flex-1 flex flex-col px-4 gap-3">
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(94,184,176,0.25)", background: "rgba(255,255,255,0.03)" }}>
            <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <span className="text-[9px] text-[#6b7a99] w-5">To:</span>
              <input value={to} onChange={e => setTo(e.target.value)} placeholder="Phone number or contact" className="flex-1 bg-transparent outline-none text-[10px] text-[#e8edf5] placeholder-[#3a4560]" />
            </div>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Type your message..."
              rows={5}
              className="w-full bg-transparent outline-none text-[10px] text-[#e8edf5] placeholder-[#3a4560] px-3 py-2 resize-none"
              style={{ scrollbarWidth: "none" }}
            />
          </div>
          <button
            className="w-full rounded-xl py-2.5 text-[11px] font-semibold text-[#0b0f1a] flex items-center justify-center gap-1.5"
            style={{ background: body.trim() ? "linear-gradient(135deg,#5eb8b0,#a78bfa)" : "rgba(255,255,255,0.08)", color: body.trim() ? "#0b0f1a" : "#3a4560" }}
          >
            <Send size={12} />
            Send Message
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Screen 10: Call Log ──────────────────────────────────────────────────────

type LogTab = "all" | "dialed" | "missed" | "received";

const CALL_LOG = [
  { type: "received", name: "Dr. Patel", num: "+1 555-0102", time: "09:10", duration: "4:32" },
  { type: "missed", name: "Unknown", num: "+1 555-0199", time: "08:45", duration: "" },
  { type: "dialed", name: "Mom", num: "+1 555-0134", time: "Yesterday", duration: "12:07" },
  { type: "received", name: "Crisis Line", num: "988", time: "Mon", duration: "8:20" },
  { type: "missed", name: "Dr. Patel", num: "+1 555-0102", time: "Sun", duration: "" },
  { type: "dialed", name: "Pharmacy", num: "+1 555-0188", time: "Sat", duration: "2:14" },
];

const LOG_ICON: Record<string, { icon: any; color: string }> = {
  received: { icon: PhoneIncoming, color: "#34d399" },
  missed: { icon: PhoneMissed, color: "#f87171" },
  dialed: { icon: PhoneOutgoing, color: "#a78bfa" },
};

function CallLogScreen({ navigate }: { navigate: (s: string) => void }) {
  const [tab, setTab] = useState<LogTab>("all");

  const filtered = tab === "all" ? CALL_LOG : CALL_LOG.filter(c => c.type === tab);

  return (
    <div className="flex flex-col h-full bg-[#0b0f1a]">
      <StatusBar />
      <NavBar onBack={() => navigate("home")} title="Call Log" />

      {/* filter tabs */}
      <div className="flex px-4 gap-1 mb-3">
        {(["all", "received", "dialed", "missed"] as LogTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 rounded-lg py-1.5 text-[8px] font-semibold capitalize transition-all"
            style={{
              background: tab === t ? (t === "missed" ? "rgba(248,113,113,0.18)" : t === "received" ? "rgba(52,211,153,0.18)" : t === "dialed" ? "rgba(167,139,250,0.18)" : "rgba(94,184,176,0.18)") : "rgba(255,255,255,0.05)",
              color: tab === t ? (t === "missed" ? "#f87171" : t === "received" ? "#34d399" : t === "dialed" ? "#a78bfa" : "#5eb8b0") : "#6b7a99",
              border: `1px solid ${tab === t ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)"}`,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 space-y-1.5" style={{ scrollbarWidth: "none" }}>
        {filtered.map((c, i) => {
          const { icon: Icon, color } = LOG_ICON[c.type];
          return (
            <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${color}18` }}>
                <Icon size={13} color={color} strokeWidth={1.8} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-[#e8edf5] truncate">{c.name}</p>
                <p className="text-[8px] text-[#6b7a99]" style={{ fontFamily: "DM Mono" }}>{c.num}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[8px] text-[#6b7a99]" style={{ fontFamily: "DM Mono" }}>{c.time}</p>
                {c.duration && <p className="text-[8px] text-[#5eb8b0]" style={{ fontFamily: "DM Mono" }}>{c.duration}</p>}
                {!c.duration && <p className="text-[8px] text-[#f87171]">missed</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

const SCREENS = ["home", "modes", "chat", "music", "reminder", "sos", "settings", "call", "sms", "calllog"] as const;
type Screen = typeof SCREENS[number];

const SCREEN_LABELS: Record<Screen, string> = {
  home: "Home",
  modes: "Mode Select",
  chat: "Chat",
  music: "Music Player",
  reminder: "Reminders",
  sos: "SOS",
  settings: "Settings",
  call: "Dialer",
  sms: "Messages",
  calllog: "Call Log",
};

export default function App() {
  const [current, setCurrent] = useState<Screen>("home");
  const currentIdx = SCREENS.indexOf(current);
  const navigate = (s: string) => setCurrent(s as Screen);

  const screenMap: Record<Screen, JSX.Element> = {
    home: <HomeScreen navigate={navigate} />,
    modes: <ModeScreen navigate={navigate} />,
    chat: <ChatScreen navigate={navigate} />,
    music: <MusicScreen navigate={navigate} />,
    reminder: <ReminderScreen navigate={navigate} />,
    sos: <SOSScreen navigate={navigate} />,
    settings: <SettingsScreen navigate={navigate} />,
    call: <CallScreen navigate={navigate} />,
    sms: <SMSScreen navigate={navigate} />,
    calllog: <CallLogScreen navigate={navigate} />,
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center py-8 px-4"
      style={{ background: "#06080f", fontFamily: "'Figtree', sans-serif" }}
    >
      {/* Header */}
      <div className="mb-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg,#5eb8b0,#a78bfa)" }}>
            <Brain size={14} color="white" />
          </div>
          <h1 className="text-lg font-extrabold text-[#e8edf5] tracking-tight">MindBuddy</h1>
        </div>
        <p className="text-[11px] text-[#6b7a99]">TFT 280×320 Screen Portfolio · ESP32 + SD Card</p>
      </div>

      {/* Device frame */}
      <div className="relative">
        <div
          className="rounded-[2rem] p-[10px] shadow-2xl"
          style={{
            background: "linear-gradient(145deg,#1e2330,#10141f)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 40px 80px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)",
          }}
        >
          <div className="flex justify-center gap-1 mb-2">
            {[...Array(5)].map((_, i) => <div key={i} className="w-1 h-1 rounded-full bg-[rgba(255,255,255,0.12)]" />)}
          </div>
          <div
            className="overflow-hidden"
            style={{ width: 280, height: 320, borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", boxShadow: "inset 0 0 20px rgba(0,0,0,0.5)" }}
          >
            {screenMap[current]}
          </div>
          <div className="flex justify-center mt-3">
            <button onClick={() => navigate("home")} className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:bg-[rgba(94,184,176,0.15)]" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
              <Home size={12} color="#6b7a99" />
            </button>
          </div>
        </div>
        <div className="absolute left-[-6px] top-16 w-1.5 h-8 rounded-l-sm" style={{ background: "rgba(255,255,255,0.08)" }} />
        <div className="absolute right-[-6px] top-16 w-1.5 h-6 rounded-r-sm" style={{ background: "rgba(255,255,255,0.08)" }} />
        <div className="absolute right-[-6px] top-24 w-1.5 h-6 rounded-r-sm" style={{ background: "rgba(255,255,255,0.08)" }} />
      </div>

      {/* Navigation */}
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={() => setCurrent(SCREENS[Math.max(0, currentIdx - 1)])}
          disabled={currentIdx === 0}
          className="w-8 h-8 rounded-full flex items-center justify-center transition-all disabled:opacity-20"
          style={{ background: "rgba(94,184,176,0.15)", border: "1px solid rgba(94,184,176,0.25)" }}
        >
          <ChevronLeft size={14} color="#5eb8b0" />
        </button>
        <div className="flex gap-1.5">
          {SCREENS.map(s => (
            <button key={s} onClick={() => setCurrent(s)} className="transition-all rounded-full" style={{ width: s === current ? 20 : 6, height: 6, background: s === current ? "#5eb8b0" : "rgba(94,184,176,0.25)" }} />
          ))}
        </div>
        <button
          onClick={() => setCurrent(SCREENS[Math.min(SCREENS.length - 1, currentIdx + 1)])}
          disabled={currentIdx === SCREENS.length - 1}
          className="w-8 h-8 rounded-full flex items-center justify-center transition-all disabled:opacity-20"
          style={{ background: "rgba(94,184,176,0.15)", border: "1px solid rgba(94,184,176,0.25)" }}
        >
          <ChevronRight size={14} color="#5eb8b0" />
        </button>
      </div>
      <p className="mt-2 text-[11px] font-semibold text-[#5eb8b0] tracking-wide">{SCREEN_LABELS[current]}</p>

      {/* Quick-jump tabs — grouped */}
      <div className="mt-4 w-full max-w-sm space-y-2">
        <div className="flex flex-wrap justify-center gap-2">
          {(["home", "modes", "chat", "music", "reminder", "sos", "settings"] as Screen[]).map(s => (
            <button
              key={s}
              onClick={() => setCurrent(s)}
              className="px-3 py-1 rounded-full text-[10px] font-semibold transition-all"
              style={{ background: s === current ? "rgba(94,184,176,0.2)" : "rgba(255,255,255,0.05)", color: s === current ? "#5eb8b0" : "#6b7a99", border: `1px solid ${s === current ? "rgba(94,184,176,0.4)" : "rgba(255,255,255,0.08)"}` }}
            >
              {SCREEN_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="flex justify-center gap-2">
          <p className="text-[9px] text-[#3a4560] self-center">Phone:</p>
          {(["call", "sms", "calllog"] as Screen[]).map(s => (
            <button
              key={s}
              onClick={() => setCurrent(s)}
              className="px-3 py-1 rounded-full text-[10px] font-semibold transition-all"
              style={{ background: s === current ? "rgba(52,211,153,0.2)" : "rgba(255,255,255,0.05)", color: s === current ? "#34d399" : "#6b7a99", border: `1px solid ${s === current ? "rgba(52,211,153,0.4)" : "rgba(255,255,255,0.08)"}` }}
            >
              {SCREEN_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-5 text-[10px] text-[#3a4560]">ST7789 · SPI · RGB565 · XPT2046 Touch · SD Card pages</p>
    </div>
  );
}
