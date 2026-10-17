// framed-on-wall mock: 13 x 19 black frame, white mat window 16.5 x 10.5 in (Sig's frame), on a farmhouse wall
// node wall.mjs <sheet.png> <out.png>
import { readFileSync } from "node:fs";
const { chromium } = await import("/home/user/node_modules/playwright/index.mjs");
const [src, out] = process.argv.slice(2);
const PPI = 46, F = 0.8; // frame face width, in
const img = "data:image/png;base64," + readFileSync(src).toString("base64");
const html = `<!doctype html><style>
body{margin:0;width:1800px;height:1150px;overflow:hidden;background:
 linear-gradient(180deg,#E9E4DA 0%,#E3DDD1 70%,#D9D2C5 100%);position:relative;font-family:sans-serif}
.wall{position:absolute;inset:0;background-image:radial-gradient(ellipse at 50% 30%,rgba(255,250,240,.55),rgba(0,0,0,0) 60%)}
.frame{position:absolute;left:${900 - (19 + 2 * F) * PPI / 2}px;top:120px;width:${(19 + 2 * F) * PPI}px;height:${(13 + 2 * F) * PPI}px;background:#1c1c1c;
 box-shadow:0 18px 30px rgba(40,30,20,.28),0 4px 8px rgba(40,30,20,.25);}
.inner{position:absolute;left:${F * PPI}px;top:${F * PPI}px;width:${19 * PPI}px;height:${13 * PPI}px;background:#FAF8F3;overflow:hidden;box-shadow:inset 0 0 6px rgba(0,0,0,.5)}
.win{position:absolute;left:${(19 - 16.5) / 2 * PPI}px;top:${(13 - 10.5) / 2 * PPI}px;width:${16.5 * PPI}px;height:${10.5 * PPI}px;overflow:hidden;
 box-shadow:0 0 0 1px #e8e3d8, inset 2px 2px 3px rgba(0,0,0,.18)}
.win img{position:absolute;left:${-(19 - 16.5) / 2 * PPI}px;top:${-(13 - 10.5) / 2 * PPI}px;width:${19 * PPI}px;height:${13 * PPI}px}
.glass{position:absolute;inset:0;background:linear-gradient(115deg,rgba(255,255,255,0) 40%,rgba(255,255,255,.10) 48%,rgba(255,255,255,0) 58%)}
.shelf{position:absolute;left:0;right:0;top:${120 + (13 + 2 * F) * PPI + 150}px;height:300px;background:linear-gradient(#7a5a3c,#6a4c31 8px,#5b4029 30px,#4a3421)}
.shelf:before{content:"";position:absolute;left:0;right:0;top:-6px;height:8px;background:#8a6a4a}
</style><div class="wall"></div><div class="frame"><div class="inner"><div class="win"><img src="${img}"></div></div><div class="glass"></div></div><div class="shelf"></div>`;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1800, height: 1150 } });
await p.setContent(html); await p.waitForTimeout(300);
await p.screenshot({ path: out }); await b.close();
