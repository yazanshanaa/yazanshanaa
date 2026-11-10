// Renders data.json into brand-matched dark/light WebP cards. No external services.
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "assets");
mkdirSync(out, { recursive: true });
const d = JSON.parse(readFileSync(join(here, "data.json"), "utf8"));

const fontDir = join(here, "node_modules", "@fontsource");
const b64 = (p) => (existsSync(p) ? readFileSync(p).toString("base64") : null);
const faces = [
  ["Inter", 400, b64(join(fontDir, "inter/files/inter-latin-400-normal.woff2"))],
  ["Inter", 600, b64(join(fontDir, "inter/files/inter-latin-600-normal.woff2"))],
  ["Inter", 800, b64(join(fontDir, "inter/files/inter-latin-800-normal.woff2"))],
  ["JBM", 400, b64(join(fontDir, "jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2"))],
  ["JBM", 700, b64(join(fontDir, "jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2"))],
]
  .filter(([, , v]) => v)
  .map(([f, w, v]) => `@font-face{font-family:${f};font-weight:${w};src:url(data:font/woff2;base64,${v})format('woff2')}`)
  .join("");

const n = (v) => Number(v ?? 0).toLocaleString("en-US");
const stats = [
  ["Contributions", n(d.contributions), "last 12 months"],
  ["Active days", n(d.activeDays), "of the last 365"],
  ["Busiest day", n(d.busiestDay), "contributions"],
  ["Current streak", n(d.currentStreak), "days"],
  ["Longest streak", n(d.longestStreak), "days"],
];
const months = d.months ?? [];
const peak = Math.max(1, ...months.map((m) => m.count));

const page = (t) => `<!doctype html><meta charset="utf-8"><style>
${faces}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:300px}
body{font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased;position:relative;
 padding:30px 40px 24px;background:${t.bg}}
.sheen{position:absolute;inset:0;background:repeating-linear-gradient(97deg,${t.sheen} 0 1px,transparent 1px 3px)}
.hd{position:relative;display:flex;align-items:center;gap:12px;margin-bottom:24px}
.hd .ln{width:26px;height:1px;background:linear-gradient(90deg,transparent,${t.accent})}
.hd .t{font-family:JBM;font-size:10.5px;font-weight:700;letter-spacing:.3em;color:${t.accent};text-transform:uppercase}
.hd .s{font-family:JBM;font-size:10px;letter-spacing:.14em;color:${t.faint};margin-left:auto;text-transform:uppercase}
.strip{position:relative;display:flex;margin-bottom:28px}
.cell{flex:1;padding:0 18px;border-left:1px solid ${t.rule}}
.cell:first-child{padding-left:0;border-left:none}
.k{font-family:JBM;font-size:8.6px;font-weight:700;letter-spacing:.19em;color:${t.faint};text-transform:uppercase;margin-bottom:9px;white-space:nowrap}
.v{font-size:36px;font-weight:800;letter-spacing:-.035em;line-height:1;color:${t.strong};font-variant-numeric:tabular-nums}
.u{font-family:JBM;font-size:9.5px;color:${t.faint};margin-top:7px;letter-spacing:.04em}
.chart{position:relative}
.ck{font-family:JBM;font-size:8.6px;font-weight:700;letter-spacing:.19em;color:${t.faint};text-transform:uppercase;margin-bottom:12px}
.bars{display:flex;align-items:flex-end;gap:7px;height:70px}
.b{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
.b u{display:block;width:100%;border-radius:3px 3px 1px 1px;background:linear-gradient(180deg,${t.bar1},${t.bar2});min-height:3px}
.b em{font-family:JBM;font-size:9px;font-style:normal;color:${t.faint};margin-bottom:6px;font-variant-numeric:tabular-nums}
.mk{display:flex;gap:7px;margin-top:8px}
.mk span{flex:1;text-align:center;font-family:JBM;font-size:9px;letter-spacing:.08em;color:${t.faint};text-transform:uppercase}
</style><div class="sheen"></div>
<div class="hd"><span class="ln"></span><span class="t">GitHub</span><span class="s">self-generated &middot; ${d.generated}</span></div>
<div class="strip">${stats
  .map(([k, v, u]) => `<div class="cell"><div class="k">${k}</div><div class="v">${v}</div><div class="u">${u}</div></div>`)
  .join("")}</div>
<div class="chart"><div class="ck">Contributions by month &middot; last 12 months</div>
<div class="bars">${months
  .map((m) => `<span class="b"><em>${m.count}</em><u style="height:${Math.max(4, Math.round((m.count / peak) * 100))}%"></u></span>`)
  .join("")}</div>
<div class="mk">${months.map((m) => `<span>${m.label}</span>`).join("")}</div>
</div>`;

const themes = {
  "github-dark": {
    bg: "linear-gradient(150deg,#070B12,#0A1119 52%,#060A10)", sheen: "rgba(255,255,255,.012)",
    accent: "#8FC9DC", faint: "#4E7288", rule: "rgba(125,211,252,.11)",
    text: "#C3D6E4", strong: "#E9F3F9", bar1: "#5EEAD4", bar2: "#1B5E7A",
  },
  "github-light": {
    bg: "linear-gradient(150deg,#FAFCFD,#EDF3F7 52%,#F4F8FA)", sheen: "rgba(11,42,58,.014)",
    accent: "#0E7490", faint: "#6D8A9C", rule: "rgba(13,105,130,.13)",
    text: "#1B3A4C", strong: "#0C2635", bar1: "#2BA8C4", bar2: "#0B4A61",
  },
};

const browser = await chromium.launch();
for (const [name, t] of Object.entries(themes)) {
  const p = await browser.newPage({ viewport: { width: 1200, height: 300 }, deviceScaleFactor: 2 });
  await p.setContent(page(t), { waitUntil: "load" });
  await p.waitForTimeout(400);
  const png = await p.screenshot();
  await sharp(png).webp({ quality: 92, effort: 6 }).toFile(join(out, `${name}.webp`));
  await p.close();
  console.log("wrote", `assets/${name}.webp`);
}
await browser.close();
