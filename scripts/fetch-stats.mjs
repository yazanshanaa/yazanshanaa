// Pulls public profile numbers from the GitHub GraphQL API and writes data.json.
// Exits non-zero on failure so the previous card stays committed and the README never breaks.
import { writeFileSync } from "node:fs";

const login = process.env.LOGIN;
const token = process.env.GITHUB_TOKEN;
if (!login || !token) { console.error("LOGIN and GITHUB_TOKEN are required"); process.exit(1); }

const query = `
query($login:String!){
  user(login:$login){
    followers{ totalCount }
    following{ totalCount }
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
if (!res.ok) { console.error("HTTP", res.status, await res.text()); process.exit(1); }
const json = await res.json();
if (json.errors) { console.error(JSON.stringify(json.errors, null, 2)); process.exit(1); }

const u = json.data?.user;
if (!u) { console.error("no user in response"); process.exit(1); }
const c = u.contributionsCollection;

// languages by bytes across non-fork owned repos
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

// streaks from the contribution calendar
const days = (c.contributionCalendar.weeks ?? []).flatMap(w => w.contributionDays).sort((a, b) => a.date.localeCompare(b.date));
let longest = 0, run = 0;
for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
let current = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (days[i].contributionCount > 0) current++;
  else if (i === days.length - 1) continue; // today may still be empty
  else break;
}
const activeDays = days.filter(d => d.contributionCount > 0).length;
const stars = (u.repositories.nodes ?? []).reduce((a, r) => a + r.stargazerCount, 0);

const data = {
  generated: new Date().toISOString().slice(0, 10),
  contributions: c.contributionCalendar.totalContributions,
  privateContributions: c.restrictedContributionsCount,
  commits: c.totalCommitContributions,
  pullRequests: c.totalPullRequestContributions,
  issues: c.totalIssueContributions,
  repositories: u.repositories.totalCount,
  followers: u.followers.totalCount,
  stars, currentStreak: current, longestStreak: longest, activeDays,
  languages,
};
writeFileSync(new URL("./data.json", import.meta.url), JSON.stringify(data, null, 2));
console.log(data);
