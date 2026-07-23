// Curated free internet-radio streams Mind Buddy AI can play to soothe the
// patient. The `id` is what the AI emits inside a [[music:<id>]] directive.
export type RadioStation = {
  id: string;
  name: string;
  genre: string;
  /** Direct audio stream URL (MP3) */
  url: string;
  /** Keywords that hint this station fits the conversation mood. */
  keywords: string[];
};

export const RADIO_STATIONS: RadioStation[] = [
  {
    id: "ambient",
    name: "SomaFM Groove Salad",
    genre: "Ambient / Chillout",
    url: "https://ice5.somafm.com/groovesalad-128-mp3",
    keywords: ["ambient", "chill", "calm", "relax", "peace", "anxious", "anxiety", "soothe", "breathe"],
  },
  {
    id: "lush",
    name: "SomaFM Lush",
    genre: "Downtempo / Vocal",
    url: "https://ice5.somafm.com/lush-128-mp3",
    keywords: ["downtempo", "vocal", "mellow", "soft", "gentle", "evening", "sad", "lonely"],
  },
  {
    id: "synth",
    name: "SomaFM Synphaera",
    genre: "Electronic / Synth",
    url: "https://ice5.somafm.com/synphaera-128-mp3",
    keywords: ["electronic", "synth", "space", "focus", "dreamy"],
  },
  {
    id: "rock",
    name: "Radio Paradise",
    genre: "Rock / Alternative",
    url: "https://stream.radioparadise.com/mp3-128",
    keywords: ["rock", "alternative", "energy", "upbeat", "motivate", "happy", "wake"],
  },
  {
    id: "lofi",
    name: "SomaFM Fluid (Lo-Fi)",
    genre: "Lo-Fi / Instrumental Hip Hop",
    url: "https://ice5.somafm.com/fluid-128-mp3",
    keywords: ["lofi", "lo-fi", "study", "focus", "hiphop", "beats", "homework", "concentrate"],
  },
  {
    id: "cyberpunk",
    name: "SomaFM Defcon",
    genre: "Cyberpunk / Industrial",
    url: "https://ice5.somafm.com/defcon-128-mp3",
    keywords: ["cyberpunk", "industrial", "dark", "intense", "gaming"],
  },
  {
    id: "piano",
    name: "1.FM Classical Piano",
    genre: "Classical / Piano",
    url: "https://strm112.1.fm/classical_mobile_mp3",
    keywords: ["piano", "classical", "relax", "calm", "soothe", "sleep", "meditate", "study"],
  },
];

export function getStation(id: string): RadioStation | undefined {
  return RADIO_STATIONS.find((s) => s.id === id.toLowerCase().trim());
}

export function randomStation(): RadioStation {
  return RADIO_STATIONS[Math.floor(Math.random() * RADIO_STATIONS.length)];
}

/** Pick a station whose keywords best match the given text, else random. */
export function pickStationForText(text: string): RadioStation {
  const t = text.toLowerCase();
  let best: RadioStation | null = null;
  let bestScore = 0;
  for (const s of RADIO_STATIONS) {
    const score = s.keywords.reduce((n, k) => (t.includes(k) ? n + 1 : n), 0);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best ?? randomStation();
}

/** Compact catalogue string for the AI system prompt. */
export const STATION_CATALOGUE = RADIO_STATIONS.map(
  (s) => `- ${s.id}: ${s.name} (${s.genre})`,
).join("\n");
