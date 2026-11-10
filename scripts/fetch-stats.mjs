// Collects the numbers for the profile stats card.
//
// Two sources, because they see different things:
//   1. The public contributions calendar (no auth) — the exact graph a visitor sees,
//      including private contributions once "Include private contributions on my
//      profile" is enabled in settings.
//   2. The GraphQL API — commits, pull requests, repositories and languages.
//      With the default GITHUB_TOKEN this is the PUBLIC view. Add a personal access
//      token with `read:user` as the STATS_TOKEN secret to include private work.
//
// Exits non-zero on failure so the previously committed card stays in place and the
// README never shows a broken image.
import { writeFileSync } from "node:fs";

const login = process.env.LOGIN;
const token = process.env.STATS_TOKEN || process.env.GITHUB_TOKEN;
if (!login || !token) { console.error("LOGIN and a token are required"); process.exit(1); }
const scoped = Boolean(process.env.STATS_TOKEN);

/* ---------- 1. public contributions calendar ---------- */
async function publicCalendar() {
  const res = await fetch(`https://github.com/users/${login}/contributions`, {
    headers: { "User-Agent": "profile-stats", Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`contributions page HTTP ${res.status}`);
  const html = await res.text();

  const total = Number((html.match(/([\d,]+)\s+contributions?\s+in\s+the\s+last\s+year/i)?.[1] ?? "").replace(/,/g, "")) || null;

  // day cells carry the date and an id; the count lives in the matching tool-tip
  const counts = new Map();
  for (const m of html.matchAll(/<tool-tip[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const text = m[2].trim();
    counts.set(m[1], /^no contributions/i.test(text) ? 0 : Number(text.match(/^([\d,]+)/)?.[1].replace(/,/g, "") ?? 0));
  }
  const days = [];
  for (const m of html.matchAll(/<td[^>]*\bdata-date="(\d{4}-\d{2}-\d{2})"[^>]*>/g)) {
    const tag = m[0];
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const inline = tag.match(/\bdata-count="(\d+)"/)?.[1];
    const count = inline !== undefined ? Number(inline) : (id && counts.has(id) ? counts.get(id) : null);
    if (count !== null) days.push({ date: m[1], count });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { total, days };
}

/* ---------- 2. GraphQL ---------- */
const query = `
query($login:String!){
  user(login:$login){
    followers{ totalCount }
    repositories(first:100, ownerAffiliations:OWNER, isFork:false, orderBy:{field:PUSHED_AT,direction:DESC}){
      totalCount
      nodes{ stargazerCount languages(first:12, orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name color } } } }
    }
    contributionsCollection{
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      restrictedContributionsCount
      contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } }
    }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "profile-stats" },
  body: JSON.stringify({ query, variables: { login } }),
});
if (!res.ok) { console.error("GraphQL HTTP", res.status, await res.text()); process.exit(1); }
const json = await res.json();
if (json.errors) { console.error(JSON.stringify(json.errors, null, 2)); process.exit(1); }
const u = json.data?.user;
if (!u) { console.error("no user in GraphQL response"); process.exit(1); }
const c = u.contributionsCollection;

/* ---------- merge ---------- */
let days = (c.contributionCalendar.weeks ?? []).flatMap(w => w.contributionDays)
  .map(d => ({ date: d.date, count: d.contributionCount }));
let total = c.contributionCalendar.totalContributions;
let source = scoped ? "graphql (scoped token)" : "graphql (public)";

try {
  const pub = await publicCalendar();
  if (pub.total !== null && pub.total >= total) {
    total = pub.total;
    if (pub.days.length > 300) days = pub.days;
    source = "public contribution graph";
  }
} catch (e) {
  console.warn("calendar scrape skipped:", e.message);
}
console.log("contribution source:", source);

days.sort((a, b) => a.date.localeCompare(b.date));
let longest = 0, run = 0;
for (const d of days) { run = d.count > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
let current = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (days[i].count > 0) current++;
  else if (i === days.length - 1) continue;  // today may still be empty
  else break;
}

const bytes = new Map(), colors = new Map();
for (const r of u.repositories.nodes ?? [])
  for (const e of r.languages?.edges ?? []) {
    bytes.set(e.node.name, (bytes.get(e.node.name) ?? 0) + e.size);
    colors.set(e.node.name, e.node.color || "#8b949e");
  }
const totalBytes = [...bytes.values()].reduce((a, b) => a + b, 0) || 1;
const languages = [...bytes.entries()]
  .sort((a, b) => b[1] - a[1]).slice(0, 7)
  .map(([name, size]) => ({ name, color: colors.get(name), pct: +(size / totalBytes * 100).toFixed(1) }));

const data = {
  generated: new Date().toISOString().slice(0, 10),
  source,
  contributions: total,
  commits: c.totalCommitContributions,
  pullRequests: c.totalPullRequestContributions,
  issues: c.totalIssueContributions,
  repositories: u.repositories.totalCount,
  followers: u.followers.totalCount,
  stars: (u.repositories.nodes ?? []).reduce((a, r) => a + r.stargazerCount, 0),
  currentStreak: current,
  longestStreak: longest,
  activeDays: days.filter(d => d.count > 0).length,
  busiestDay: days.reduce((m, d) => Math.max(m, d.count), 0),
  languages,
};
writeFileSync(new URL("./data.json", import.meta.url), JSON.stringify(data, null, 2));
console.log(data);
