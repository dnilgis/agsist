// Ag in 60: draw every frame of the plan in a headless browser and stitch them
// with the voice into an MP4 (1080 x 1920, 30 fps, H.264 + AAC, faststart).
//
//   node scripts/ag60/render.mjs --out DIR [--fps 30] [--stills] [--only-stills]
//
// DIR holds plan.json (build_plan.py, timed by voice.py) and voice.wav. Writes
// DIR/ag60.mp4, DIR/captions.srt (already written by voice.py) and, with
// --stills, DIR/stills/*.jpg and DIR/contact.jpg (one frame per scene).
// Browser: playwright (CHROMIUM env picks a local executable).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(opt('--out', path.join(process.env.TMPDIR || '/tmp', 'ag60')));
const FPS = +opt('--fps', 30);
const STILLS = args.includes('--stills') || args.includes('--only-stills');
const ONLY_STILLS = args.includes('--only-stills');

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through */ }
  const req = createRequire(import.meta.url);
  for (const p of [process.env.PLAYWRIGHT_PATH, '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) {
    try { return req(p); } catch { /* next */ }
  }
  throw new Error('playwright not found (npm install --no-save playwright)');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg' };
function serve() {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const base = u.startsWith('/out/') ? OUT : ROOT;
    const rel = u.startsWith('/out/') ? u.slice(5) : u.slice(1);
    const f = path.resolve(base, rel);
    if (!f.startsWith(base) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

const plan = JSON.parse(fs.readFileSync(path.join(OUT, 'plan.json'), 'utf8'));
const total = plan.total || plan.scenes.reduce((m, s) => Math.max(m, s.start + s.dur), 0);
const srv = await serve();
const port = srv.address().port;
const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => { console.error('page error:', e.message); process.exitCode = 1; });
await page.goto(`http://127.0.0.1:${port}/scripts/ag60/scenes.html?plan=/out/plan.json`);
await page.waitForFunction(() => window.AG60_READY === true, null, { timeout: 60000 });

if (STILLS) {
  const dir = path.join(OUT, 'stills');
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const [i, s] of plan.scenes.entries()) {
    const t = s.start + Math.min(s.dur * .8, s.dur - .05);
    await page.evaluate((t) => window.AG60.seek(t), t);
    const f = path.join(dir, `${String(i + 1).padStart(2, '0')}-${s.kind}.jpg`);
    await page.screenshot({ path: f, type: 'jpeg', quality: 88 });
    files.push(f);
  }
  // contact sheet: 4 across, scaled to 270 x 480 a frame
  const cols = 4, rows = Math.ceil(files.length / cols);
  const inputs = files.flatMap((f) => ['-i', f]);
  const scale = files.map((_, i) => `[${i}:v]scale=270:480[s${i}]`).join(';');
  const layout = files.map((_, i) => `${(i % cols) * 270}_${Math.floor(i / cols) * 480}`).join('|');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex',
    `${scale};${files.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${files.length}:layout=${layout}:fill=black[v]`, '-map', '[v]', '-frames:v', '1', '-q:v', '3', path.join(OUT, 'contact.jpg')]);
  console.log(`stills: ${files.length} scenes, contact sheet ${rows} rows -> ${path.join(OUT, 'contact.jpg')}`);
}

if (!ONLY_STILLS) {
  const wav = path.join(OUT, 'voice.wav');
  const mp4 = path.join(OUT, 'ag60.mp4');
  const n = Math.ceil(total * FPS);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    ...(fs.existsSync(wav) ? ['-i', wav] : ['-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=48000:cl=mono']),
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-t', total.toFixed(3), '-movflags', '+faststart', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((r, j) => ff.on('close', (c) => (c ? j(new Error('ffmpeg ' + c)) : r())));
  const t0 = Date.now();
  for (let f = 0; f < n; f++) {
    await page.evaluate((t) => window.AG60.seek(t), f / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 300 === 0) console.log(`frame ${f}/${n} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  ff.stdin.end();
  await done;
  console.log(`video: ${n} frames, ${total.toFixed(2)} s -> ${mp4}`);
}
await browser.close();
srv.close();
