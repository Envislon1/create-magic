import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Shield,
  AlertTriangle,
  MessageCircle,
  Pill,
  Music2,
  Smile,
  Wind,
  Laugh,
  HeartPulse,
  ArrowRight,
  Check,
  Download,
} from "lucide-react";
import deviceImage from "@/assets/mindbuddy-device.jpg";
import { MIND_BUDDY_APP_URL } from "@/lib/app-config";
import { useServerFn } from "@tanstack/react-start";
import { getActiveManual } from "@/lib/manuals.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mind Buddy — Pocket mental-health companion device" },
      {
        name: "description",
        content:
          "Mind Buddy is a pocket mental-health companion: SOS crisis button, medication alarms, mood tracking, calm breathing, jokes, music, and a 24/7 AI you can talk to.",
      },
      { property: "og:title", content: "Mind Buddy — Pocket mental-health companion device" },
      {
        property: "og:description",
        content:
          "SOS crisis button, medication alarms, mood tracking, calm breathing, jokes, music, and a 24/7 AI companion — in your pocket.",
      },
      { property: "og:image", content: `${MIND_BUDDY_APP_URL}/og-image.jpg` },
      { name: "twitter:image", content: `${MIND_BUDDY_APP_URL}/og-image.jpg` },
    ],
  }),
  component: LandingPage,
});

const features = [
  {
    icon: Laugh,
    title: "Tell jokes",
    body: "On-demand humor to lift your mood when the day feels heavy.",
  },
  {
    icon: AlertTriangle,
    title: "SOS crisis button",
    body: "One long-press alerts your caregiver instantly — with a backup email and a live siren in the app.",
    accent: "sos" as const,
  },
  {
    icon: Music2,
    title: "Music & singing",
    body: "Ask for any song or genre and Mind Buddy streams it straight to the speaker.",
  },
  {
    icon: Smile,
    title: "Mood tracker",
    body: "Daily check-ins and a visual mood log so you (and your caregiver) can spot patterns early.",
  },
  {
    icon: Pill,
    title: "Med reminders",
    body: "Alarm + spoken voice prompt at the right time, with compliance logged automatically.",
  },
  {
    icon: Wind,
    title: "Calm exercises",
    body: "Guided breathing and short meditation prompts to ground you in seconds.",
  },
  {
    icon: MessageCircle,
    title: "24/7 AI conversation",
    body: "A warm, private companion trained for anxiety, depression, PTSD, ADHD, bipolar and schizophrenia support.",
  },
];

function LandingPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const fetchManual = useServerFn(getActiveManual);
  const [manual, setManual] = useState<{
    file_url: string;
    file_name: string;
    version: string | null;
  } | null>(null);

  useEffect(() => {
    fetchManual()
      .then((r) => setManual(r.manual))
      .catch(() =>
        setManual({
          file_url: "/mind-buddy-manual.pdf",
          file_name: "mind-buddy-manual.pdf",
          version: "1.0",
        }),
      );
  }, [fetchManual]);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/app" });
  }, [user, loading, navigate]);

  return (
    <main className="min-h-screen bg-background">
      <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-safe shadow-safe flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <span className="font-semibold text-lg">Mind Buddy</span>
        </div>
        <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
          <a href="#features" className="hover:text-foreground transition">Features</a>
          <a href="#how" className="hover:text-foreground transition">How it works</a>
          <a href="#who" className="hover:text-foreground transition">Who it's for</a>
        </nav>
        <Link to="/auth">
          <Button variant="ghost" size="sm">Sign in</Button>
        </Link>
      </header>

      {/* HERO */}
      <section className="max-w-6xl mx-auto px-6 pt-6 pb-16 grid md:grid-cols-2 gap-10 items-center">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground">
            <HeartPulse className="w-3.5 h-3.5 text-primary" />
            Hardware + app · designed with clinicians
          </div>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight">
            A portable mental <br />
            <span className="text-primary">health chatbox.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-md">
            Mind Buddy is a pocket-sized companion device that listens, reminds you
            to take your meds, plays you music, walks you through calm exercises —
            and brings help with one tap when you need it most.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/auth">
              <Button size="lg" className="shadow-safe">
                Get started <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
            <a href="#features">
              <Button size="lg" variant="outline">See all features</Button>
            </a>
            {manual && (
              <a
                href={manual.file_url}
                download={manual.file_name}
                target="_blank"
                rel="noreferrer"
              >
                <Button size="lg" variant="outline">
                  <Download className="w-4 h-4 mr-1" />
                  Download manual
                </Button>
              </a>
            )}
          </div>
          <ul className="grid grid-cols-2 gap-y-2 gap-x-6 text-sm text-muted-foreground pt-2 max-w-md">
            {[
              "One-tap SOS to caregiver",
              "Voice-first interaction",
              "Works offline for alarms",
              "Private, end-to-end",
            ].map((b) => (
              <li key={b} className="flex items-center gap-2">
                <Check className="w-4 h-4 text-primary shrink-0" /> {b}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative">
          <div className="absolute -inset-6 rounded-3xl bg-gradient-safe opacity-20 blur-2xl" aria-hidden />
          <img
            src={deviceImage}
            alt="Mind Buddy mental-health companion device"
            width={1200}
            height={1200}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className="relative w-full max-w-md mx-auto rounded-3xl shadow-soft object-cover aspect-square"
          />
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="border-t border-border/60 bg-card/40">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <div className="max-w-2xl mb-10">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              Seven things Mind Buddy does for you, every day.
            </h2>
            <p className="text-muted-foreground mt-3">
              Each feature was shaped by people living with anxiety, depression,
              PTSD, ADHD, bipolar disorder and schizophrenia — and the caregivers
              looking out for them.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((f) => {
              const Icon = f.icon;
              const isSos = f.accent === "sos";
              return (
                <article
                  key={f.title}
                  className="group rounded-2xl border border-border/60 p-6 bg-background hover:shadow-soft transition"
                >
                  <div
                    className={
                      "w-11 h-11 rounded-xl flex items-center justify-center mb-4 " +
                      (isSos
                        ? "bg-gradient-sos shadow-sos text-white"
                        : "bg-muted text-primary")
                    }
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-semibold mb-1.5">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="max-w-6xl mx-auto px-6 py-20">
        <div className="grid lg:grid-cols-3 gap-8">
          <div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              How it works
            </h2>
            <p className="text-muted-foreground mt-3">
              Plug the device in once, pair it with your phone, and Mind Buddy
              quietly takes care of the rest.
            </p>
          </div>
          <ol className="lg:col-span-2 space-y-6">
            {[
              {
                step: "01",
                title: "Pair in under a minute",
                body: "Sign in on the web app, scan the 6-character pairing code shown on the device's OLED, and connect Wi-Fi from the captive portal.",
              },
              {
                step: "02",
                title: "Set your meds and your caregiver",
                body: "Enter medication times once. Add the email of a caregiver who should hear about SOS alerts.",
              },
              {
                step: "03",
                title: "Carry it everywhere",
                body: "Talk to it, listen to it, lean on it. Long-press the red button and help is on the way — instantly.",
              },
            ].map((s) => (
              <li key={s.step} className="flex gap-5">
                <div className="text-3xl font-bold text-primary tabular-nums shrink-0 w-14">
                  {s.step}
                </div>
                <div>
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section id="who" className="border-t border-border/60 bg-card/40">
        <div className="max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              Designed for people who need a calm voice on the hardest days.
            </h2>
            <p className="text-muted-foreground mt-4">
              Mind Buddy is for patients living with anxiety, depression, PTSD,
              ADHD, bipolar disorder, schizophrenia — and for the families,
              partners and clinicians who walk alongside them.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              "Anxiety",
              "Depression",
              "PTSD",
              "ADHD",
              "Bipolar",
              "Schizophrenia",
            ].map((c) => (
              <div
                key={c}
                className="rounded-xl border border-border/60 bg-background px-4 py-3 text-sm font-medium"
              >
                {c}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-6 py-20 text-center space-y-5">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
          Bring Mind Buddy home.
        </h2>
        <p className="text-muted-foreground">
          Free to set up. Pair as many caregivers as you need. Your data stays
          private and end-to-end.
        </p>
        <Link to="/auth">
          <Button size="lg" className="shadow-safe">
            Get started <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </Link>
      </section>

      <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Mind Buddy · {MIND_BUDDY_APP_URL.replace("https://", "")}
      </footer>
    </main>
  );
}
