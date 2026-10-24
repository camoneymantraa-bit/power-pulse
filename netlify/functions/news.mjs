// Live India power-sector wire: pulls Google News RSS searches, keeps power-sector items only.
const BASE = "https://news.google.com/rss/search?hl=en-IN&gl=IN&ceid=IN:en&q=";
const QUERIES = [
  "India power sector", "India electricity demand OR peak demand", "India power shortage OR power cut",
  "thermal power plant India", "coal stock power plants India", "solar power project India MW",
  "wind energy India MW", "battery energy storage India BESS", "pumped storage India",
  "transmission line India POWERGRID OR ISTS", "discom India tariff", "CERC OR SERC order power",
  "Ministry of Power India", "NTPC", "NHPC OR SJVN OR NLC India", "Tata Power OR Adani Power OR JSW Energy",
  "Adani Green OR ReNew OR ACME Solar", "nuclear power India NPCIL", "IEX power exchange price",
  "SECI tender", "green hydrogen India", "smart meter India discom", "hydro power project India",
];
const EXCLUDE = /\b(PFC|PFCL|Power Finance Corp\w*|REC Ltd|REC Limited|RECL|News Radar|NRD)\b/i;
const MUST = /\b(power|electricity|energy|solar|wind|grid|coal|thermal|hydro\w*|nuclear|discoms?|transmission|batter(y|ies)|storage|BESS|MW|GW|GWh|MWh|tariff|renewables?|PPA|substation|megawatt|gigawatt|NTPC|NHPC|SJVN|SECI|CERC|POWERGRID|IEX|turbine|module|kV)\b/i;
const NOISE = /\b(horoscope|cricket|IPL|box office|movie|bollywood|power ?bank|powerlifting|power couple|horsepower|willpower|superpower|power play|powerplay|RRB|recruitment|admit card|apply online|vacanc(y|ies)|syllabus|exam|answer key|result date|cut ?off marks)\b/i;
const SEGS = [
  ["storage", /\b(BESS|batter(y|ies)|storage|pumped|MWh|GWh)\b/i],
  ["transmission", /\b(transmission|substation|kV|ISTS|POWERGRID|PGCIL|grid corridor|green energy corridor|ckm)\b/i],
  ["distribution", /\b(discoms?|distribution|smart meter\w*|RDSS|consumers?|bill\w*|power cuts?|outage|load ?shedding)\b/i],
  ["nuclear", /\b(nuclear|NPCIL|atomic|SMR|reactor)\b/i],
  ["coal", /\b(coal|lignite|Coal India|gasification|mines?)\b/i],
  ["thermal", /\b(thermal|supercritical|TPP|gas-based|gas power|Adani Power|boiler)\b/i],
  ["renewables", /\b(solar|wind|renewables?|green energy|hybrid|RTC|FDRE|hydro\w*|hydrogen|module|cells?|ALMM|rooftop|PM-?KUSUM|Surya Ghar)\b/i],
  ["policy", /\b(CERC|SERC|[A-Z]ERC|Ministry|ministry|policy|regulation\w*|rules?|draft|guidelines?|cabinet|Cabinet|APTEL|Supreme Court|amendment|scheme)\b/i],
  ["finance", /\b(profit|revenue|Q[1-4]|results|shares?|stock|IPO|bonds?|NCD|rating|funding|raises?|order book)\b/i],
];
const STRESS = /\b(shortage|shortfall|deficit|power cuts?|outage|blackout|delay\w*|loss|losses|dues|default\w*|cancel\w*|terminat\w*|curtail\w*|critical\w*|crisis|tripp\w*|probe|penalt\w*|protest|strike|fall|falls|slump\w*|plunge\w*|disrupt\w*)\b/i;
const POLICY = /\b(CERC|SERC|[A-Z]ERC|Ministry|policy|regulation\w*|rules?|draft|guidelines?|cabinet|Cabinet|APTEL|court|notif\w*|amend\w*)\b/i;

const dec = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? dec(m[1]) : ""; };
const key = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 70);

export function parse(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const x = m[1];
    const source = tag(x, "source");
    let title = tag(x, "title");
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
    const link = tag(x, "link"), date = new Date(tag(x, "pubDate"));
    if (!title || !link || isNaN(date)) continue;
    out.push({ title, link, source, t: date.toISOString() });
  }
  return out;
}
export function classify(it) {
  const s = it.title;
  if (EXCLUDE.test(s) || EXCLUDE.test(it.source) || NOISE.test(s) || !MUST.test(s)) return null;
  const seg = SEGS.filter(([, r]) => r.test(s)).map(([k]) => k).slice(0, 2);
  const tone = STRESS.test(s) ? "stress" : POLICY.test(s) ? "policy" : "build";
  return { ...it, seg: seg.length ? seg : [/\b(NTPC|plant|unit|power station|generation)\b/i.test(s) ? "thermal" : "policy"], tone };
}

export default async (req) => {
  const results = await Promise.allSettled(QUERIES.map(async (q) => {
    const r = await fetch(BASE + encodeURIComponent(q + " when:3d"), {
      headers: { "user-agent": "Mozilla/5.0 (compatible; PowerPulse/1.0)" }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return parse(await r.text());
  }));
  const seen = new Map();
  for (const r of results) if (r.status === "fulfilled") for (const it of r.value) {
    const c = classify(it); if (!c) continue;
    const k = key(c.title); const prev = seen.get(k);
    if (prev) { if (c.source && !prev.also.includes(c.source) && prev.source !== c.source) prev.also.push(c.source); continue; }
    seen.set(k, { ...c, also: [] });
  }
  const items = [...seen.values()].sort((a, b) => b.t.localeCompare(a.t)).slice(0, 250);
  const ok = results.filter((r) => r.status === "fulfilled").length;
  return new Response(JSON.stringify({ fetchedAt: new Date().toISOString(), feeds: ok, of: QUERIES.length, count: items.length, items }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
      "netlify-cdn-cache-control": "public, durable, s-maxage=180, stale-while-revalidate=300",
    },
  });
};
export const config = { path: "/api/news" };
