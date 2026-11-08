/*
 * Checks that every demo in this repository still decodes.
 *
 * Two passes, cheapest first:
 *
 *  1. copies - each demo carries its own copy of the solver and of the
 *     accessors it names, because no page sets script-directory and the tags
 *     then resolve the names against the page's own directory. A demo whose
 *     folder is missing one of those files is broken before a browser is even
 *     started, and that is the failure mode a partial solver roll-out
 *     produces. No browser needed.
 *
 *  2. decode - serve the checkout and open each page in headless Chromium,
 *     then wait for every universal-* element to produce something. A <video>,
 *     <audio> or <img> tag is done when its decodingPromise resolves. A
 *     <canvas> tag never resolves: it renders frame after frame for as long as
 *     the page lives. Reading its pixels does not work either, because the
 *     3D demos (bifs, vrml) render through WebGL and getContext('2d') returns
 *     null on them. So the canvas check screenshots the element and asks
 *     whether the image has more than one colour - which holds for a 2D
 *     canvas, a WebGL one, and a blank one alike.
 *
 * Usage:
 *   node ci/check-demos.mjs                      # serve this checkout
 *   node ci/check-demos.mjs --base https://...   # test an already-deployed site
 *   node ci/check-demos.mjs --only flv,mkv       # a subset
 *   node ci/check-demos.mjs --copies-only        # pass 1 alone
 *
 * Writes JUnit XML to ci/showcase-results.xml and exits non-zero on failure.
 */
import { createServer } from 'node:http';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* Checks known not to pass, per pass name, reported as skipped so this job
 * goes red on a new break rather than on the backlog. See ci/known-failures.json. */
let KNOWN = {};
try { KNOWN = JSON.parse(await readFile(join(ROOT, 'ci', 'known-failures.json'), 'utf8')); } catch {}
const knownIn = (pass, name) => (KNOWN[pass] || {})[name] || null;
const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf('--' + n); return i < 0 ? d : (argv[i + 1] || true); };
const DEMO_TIMEOUT = Number(flag('timeout', 45000));
const ONLY = flag('only') ? String(flag('only')).split(',').map(s => s.trim()) : null;
const BASE = flag('base');
const COPIES_ONLY = argv.includes('--copies-only');

/* ---------- discovery ---------- */

const TAG_RE = /<(?:video|audio|img|canvas)\b[^>]*?\busing="([^"]+)"[^>]*>/gis;
const attrOf = (tag, name) => {
  const m = new RegExp('\\b' + name + '="([^"]*)"', 'i').exec(tag);
  return m ? m[1] : null;
};

async function discover() {
  const demos = [];
  for (const name of (await readdir(ROOT, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name)) {
    if (name.startsWith('.') || name === 'ci' || name === 'node_modules') continue;
    const page = join(ROOT, name, 'index.html');
    if (!existsSync(page)) continue;
    if (ONLY && !ONLY.includes(name)) continue;
    const html = await readFile(page, 'utf8');
    const tags = [];
    for (const m of html.matchAll(TAG_RE)) {
      tags.push({
        raw: m[0],
        kind: /^<(\w+)/i.exec(m[0])[1].toLowerCase(),
        using: m[1],
        with: (attrOf(m[0], 'with') || '').split(';').map(s => s.trim()).filter(Boolean),
        scriptDirectory: attrOf(m[0], 'script-directory'),
        src: attrOf(m[0], 'src') || attrOf(m[0], 'data-src')
      });
    }
    if (tags.length) demos.push({ name, tags });
  }
  return demos.sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------- pass 1: copies ---------- */

async function checkCopies(demos) {
  const results = [];
  for (const d of demos) {
    const missing = [];
    for (const t of d.tags) {
      // a page that sets script-directory resolves elsewhere on purpose
      if (t.scriptDirectory) continue;
      const need = [t.using + '.js', t.using + '.wasm', ...t.with.map(a => a + '.wasm')];
      // A source inside the demo's own folder is committed and must be there.
      // One above it lives in test_sequences/, which is gitignored and filled
      // by get_testing_files.sh, so its absence says nothing about this commit.
      if (t.src && !/^(https?:|blob:|data:)/.test(t.src) && !t.src.startsWith('..')) need.push(t.src);
      for (const f of need) if (!existsSync(join(ROOT, d.name, f))) missing.push(f);
    }
    results.push({ name: d.name, ok: missing.length === 0, missing: [...new Set(missing)] });
  }
  return results;
}

/* ---------- pass 1b: what the registry says these accessors support ---------- */

/* Each published accessor declares the runtimes it was built against, in its
 * "using" list. A demo that names a runtime absent from that list is broken by
 * declaration, whatever the files next to it look like - which is how the avif
 * demo asked mm_solver_minimal_1.0.1 to load avif_1 and libaom_1, neither of
 * which supports it. Checking this costs one HTTP request and no browser. */
const REGISTRY = process.env.BEVARA_REGISTRY || 'https://registry.bevara.ddns.net';

async function checkRegistry(demos) {
  let index;
  try {
    const r = await fetch(REGISTRY + '/accessors/index.json');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    index = await r.json();
  } catch (e) {
    console.log(`  skipped: registry unreachable (${e.message})`);
    return null;
  }
  const byFile = new Map();
  for (const f of index.filters || []) {
    if (f.file) byFile.set(f.file, f);
  }
  const results = [];
  for (const d of demos) {
    const bad = [], unpublished = [];
    for (const t of d.tags) {
      for (const a of t.with) {
        const entry = byFile.get(a + '.wasm');
        if (!entry) {
          /* An accessor the registry has never heard of is a local build that
           * nothing keeps in step with the solver. Most of those still work,
           * so this is a warning rather than a failure - but it is how mkv
           * ended up loading an ffdmx_1 from an older ABI and dying on a
           * missing stub, so it is worth saying out loud. */
          unpublished.push(`${a} is not published in the registry, so nothing keeps it in step with ${t.using}`);
          continue;
        }
        const using = entry.using || [];
        if (using.length && !using.includes(t.using)) {
          bad.push(`${a} (${entry.name}@${entry.version}) does not list ${t.using}; it supports ${using.join(', ')}`);
        }
      }
    }
    results.push({ name: d.name, ok: bad.length === 0, bad, unpublished });
  }
  return results;
}

/* ---------- static server ---------- */

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function serve() {
  const srv = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = join(ROOT, p);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      const s = await stat(file).catch(() => null);
      if (!s || !s.isFile()) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': s.size,
        'Cache-Control': 'no-store'
      });
      res.end(await readFile(file));
    } catch (e) { res.writeHead(500).end(String(e)); }
  });
  return new Promise(r => srv.listen(0, () => r({ srv, port: srv.address().port })));
}

/* A rendered canvas is never one flat colour; a blank one always is. Compare
 * the PNG's bytes rather than decoding it: a single-colour image compresses to
 * a handful of distinct bytes in its pixel data, anything real does not. */
function manyColours(png) {
  const seen = new Set();
  for (let i = 0; i < png.length; i += 7) { seen.add(png[i]); if (seen.size > 24) return true; }
  return false;
}

/* ---------- pass 2: decode, in the page ---------- */

/* Runs inside the demo page. Resolves to one entry per universal-* element. */
const IN_PAGE = `async (timeout) => {
  const els = [...document.querySelectorAll('[is]')]
    .filter(e => (e.getAttribute('is') || '').startsWith('universal'));
  const out = [];
  for (const el of els) {
    const label = el.tagName.toLowerCase() + ' ' + (el.getAttribute('src') || el.getAttribute('data-src') || '?').split('/').pop();
    // a canvas tag streams for as long as the page lives and never settles:
    // leave it to the screenshot check outside the page
    if (el.tagName.toLowerCase() === 'canvas') {
      el.setAttribute('data-bevara-check', String(out.length));
      out.push({ label, canvas: true, ok: null, why: '' });
      continue;
    }
    if (!el.decodingPromise) { out.push({ label, ok: false, why: 'no decodingPromise - the tag never upgraded' }); continue; }
    try {
      const url = await Promise.race([
        el.decodingPromise,
        new Promise((_, rj) => setTimeout(() => rj(new Error('decode timed out after ' + timeout + 'ms')), timeout))
      ]);
      /* The promise resolves even when the source 404s, so the result has to
       * be weighed. Ask the element, not the URL: the tag may revoke its
       * object URL as soon as the browser has it, and fetching a revoked blob
       * fails although the decode worked - that is how theora reported
       * "Failed to fetch" on a demo that plays. Give the element a few seconds
       * to reach metadata, since the promise can resolve before it has.
       */
      let size = 0, how = '';
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const nat = el.naturalWidth || el.videoWidth || 0;
        const dur = Number.isFinite(el.duration) ? el.duration : 0;
        if (nat > 0) { size = nat; how = 'naturalWidth/videoWidth ' + nat; break; }
        if (dur > 0) { size = dur; how = 'duration ' + dur.toFixed(2) + 's'; break; }
        if ((el.readyState || 0) >= 1) { size = 1; how = 'readyState ' + el.readyState; break; }
        await new Promise(s => setTimeout(s, 250));
      }
      /* Nothing visible or audible to measure - an <audio> tag that never
       * reaches metadata still has the decoded bytes behind its URL. */
      if (!size && url) {
        try { size = (await (await fetch(url)).arrayBuffer()).byteLength; how = size + ' bytes'; }
        catch (e) { out.push({ label, ok: false, why: 'nothing decoded, and the result URL is gone: ' + e.message }); continue; }
      }
      out.push({ label, ok: size > 0, why: size > 0 ? '' : 'decoded to an empty result', how });
    } catch (e) { out.push({ label, ok: false, why: String(e && e.message || e) }); }
  }
  return out;
}`;

async function checkDecode(demos, base) {
  const puppeteer = (await import('puppeteer')).default;
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || undefined,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      /* A container gets 64 MB of /dev/shm and Chromium moves response bodies
       * through shared memory, which silently breaks fetches of a few hundred
       * KB - exactly what the media in these demos weigh. */
      '--disable-dev-shm-usage',
      /* The 3D demos (bifs, vrml) and the canvas ones render through WebGL,
       * which has no GPU on a build agent. Without this they draw nothing and
       * the canvas check reports the agent's lack of a GPU as a broken demo -
       * bifs, hevc-canvas, video_bench and xvid-canvas all failed that way on
       * Jenkins while passing on a laptop. */
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader'
    ]
  });
  const results = [];
  for (const d of demos) {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error' && m.text().trim()) errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', e => errors.push('pageerror: ' + String(e.message).slice(0, 200)));
    page.on('requestfailed', r => errors.push('request failed: ' + r.url().replace(base, '') + ' ' + (r.failure()?.errorText || '')));
    let tags = [];
    try {
      await page.goto(base + '/' + d.name + '/', { waitUntil: 'load', timeout: 30000 });
      await new Promise(r => setTimeout(r, 800));          // let the custom elements upgrade
      tags = await page.evaluate(`(${IN_PAGE})(${DEMO_TIMEOUT})`);
      // canvas tags: screenshot the element and look for more than one colour.
      // Works for a 2D canvas and a WebGL one alike, which reading pixels from
      // the page does not.
      for (const t of tags.filter(x => x.canvas)) {
        const idx = tags.indexOf(t);
        const handle = await page.$(`[data-bevara-check="${idx}"]`);
        /* An element outside the viewport, or with a zero box, cannot be
         * screenshotted at all - "canvas could not be captured" was that, not
         * a broken demo. */
        try { await handle.evaluate(e => e.scrollIntoView({ block: 'center' })); } catch {}
        let shot = null;
        const deadline = Date.now() + DEMO_TIMEOUT;
        while (Date.now() < deadline) {
          try { shot = await handle.screenshot({ encoding: 'binary' }); } catch { shot = null; }
          if (shot && manyColours(shot)) break;
          await new Promise(r => setTimeout(r, 1000));
        }
        t.ok = !!(shot && manyColours(shot));
        t.how = t.ok ? 'painted' : '';
        /* No pixels does not prove the demo is broken: a build agent may have
         * no GPU and no software rasteriser the browser will use, and then
         * nothing is drawn however well the pipeline runs. Fall back to a
         * weaker but real signal - the player sizes the canvas from the
         * stream, so a canvas still at the 300x150 default was never
         * configured. Say which signal was used, so a green line is not
         * mistaken for a pixel check. */
        if (!t.ok) {
          const sized = await handle.evaluate(e => ({ w: e.width, h: e.height })).catch(() => null);
          if (sized && !(sized.w === 300 && sized.h === 150) && sized.w > 0 && sized.h > 0) {
            t.ok = true;
            t.how = `configured ${sized.w}x${sized.h}, not painted (no GPU here)`;
          } else {
            t.why = shot
              ? `canvas is a single flat colour and still at ${sized ? sized.w + 'x' + sized.h : 'an unknown size'} after ${DEMO_TIMEOUT}ms`
              : 'canvas could not be captured and was never sized by the pipeline';
          }
        }
        delete t.canvas;
      }
    } catch (e) {
      tags = [{ label: 'page', ok: false, why: String(e && e.message || e).slice(0, 200) }];
    }
    await page.close();
    const ok = tags.length > 0 && tags.every(t => t.ok);
    results.push({ name: d.name, ok, tags, errors: [...new Set(errors)].slice(0, 4) });
    const weak = tags.find(t => t.how && t.how.includes('not painted'));
    process.stdout.write((ok ? '  ok   ' : '  FAIL ') + d.name +
      (ok ? (weak ? '  (' + weak.how + ')' : '') : '  ' + tags.filter(t => !t.ok).map(t => t.label + ': ' + t.why).join(' | ')) + '\n');
  }
  await browser.close();
  return results;
}

/* ---------- JUnit ---------- */

const xml = (s) => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function junit(copies, registry, decode, registryRows) {
  const suites = [];
  const sect = (name, cases, tag) =>
    `  <testsuite name="${xml(name)}" tests="${cases.length}" failures="${tag === 'failure' ? cases.length : 0}" skipped="${tag === 'skipped' ? cases.length : 0}">\n` +
    cases.map(c => `    <testcase classname="showcase.${xml(name.split('.')[0])}" name="${xml(c.name)}">` +
      (tag ? `\n      <${tag} message="${xml(c.why || '')}"/>\n    ` : '') + `</testcase>`).join('\n') +
    `\n  </testsuite>`;
  for (const c of [copies, registry, decode].filter(Boolean)) {
    suites.push(sect(c.pass, c.ok, null));
    if (c.failed.length) suites.push(sect(c.pass + '.failed', c.failed, 'failure'));
    if (c.fixed.length) suites.push(sect(c.pass + '.to-retire', c.fixed.map(r =>
      ({ name: r.name, why: 'passes now; delete its entry from ci/known-failures.json so a future break is caught' })), 'failure'));
    if (c.known.length) suites.push(sect(c.pass + '.known', c.known, 'skipped'));
  }
  const warns = (registryRows || []).filter(r => r.unpublished.length);
  if (warns.length) suites.push(sect('compatible.unpublished',
    warns.map(r => ({ name: r.name, why: r.unpublished.join('; ') })), 'skipped'));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${suites.join('\n')}\n</testsuites>\n`;
}

/* ---------- main ---------- */

const demos = await discover();
console.log(`${demos.length} demos, ${demos.reduce((n, d) => n + d.tags.length, 0)} Bevara tags\n`);

/* Splits a pass's results against the baseline. A listed failure is skipped; a
 * listed entry that now passes is a failure, so the list cannot rot; and if the
 * baseline masks every single check, the pass fails anyway - a wholesale
 * breakage must never look green. */
function classify(key, label, rows, failWhy) {
  const out = { pass: label, ok: [], failed: [], known: [], fixed: [] };
  for (const r of rows) {
    const why = knownIn(key, r.name);
    if (r.ok && why) out.fixed.push({ ...r, why });
    else if (r.ok) out.ok.push(r);
    else if (why) out.known.push({ ...r, why });
    else out.failed.push({ ...r, why: failWhy(r) });
  }
  if (rows.length && !out.ok.length && !out.failed.length) {
    out.failed.push({ name: '(every check in this pass is on the baseline)',
      why: 'nothing was actually verified; the baseline cannot mask a whole pass' });
  }
  return out;
}

function show(c) {
  for (const r of c.ok) console.log(`  ok    ${r.name}`);
  for (const r of c.failed) console.log(`  FAIL  ${r.name}  ${r.why}`);
  for (const r of c.fixed) console.log(`  FIXED ${r.name}  passes now - remove it from ci/known-failures.json`);
  for (const r of c.known) console.log(`  known ${r.name}  ${r.why}`);
  console.log(`  ${c.ok.length}/${c.ok.length + c.failed.length} ${c.pass}` +
    (c.known.length ? `, ${c.known.length} known` : '') + (c.fixed.length ? `, ${c.fixed.length} to retire` : '') + '\n');
}

console.log('pass 1: local copies of the solver and accessors');
const copies = classify('copies', 'complete', await checkCopies(demos), r => 'missing: ' + r.missing.join(', '));
show(copies);

console.log('pass 1b: runtime compatibility declared by the registry');
const registryRows = await checkRegistry(demos);
let registry = null;
if (registryRows) {
  registry = classify('registry', 'compatible', registryRows, r => r.bad.join('; '));
  show(registry);
  for (const r of registryRows) for (const u of r.unpublished) console.log(`  warn  ${r.name}  ${u}`);
  if (registryRows.some(r => r.unpublished.length)) console.log('');
} else {
  console.log('');
}

let decode = null;
if (!COPIES_ONLY) {
  let server = null, base = BASE;
  if (!base) { server = await serve(); base = `http://127.0.0.1:${server.port}`; }
  console.log(`pass 2: decode, against ${base}`);
  let rows;
  try { rows = await checkDecode(demos, base); } finally { server?.srv.close(); }
  decode = classify('decode', 'decode', rows, r =>
    r.tags.filter(t => !t.ok).map(t => t.label + ': ' + t.why).join(' | ') +
    (r.errors.length ? ' || console: ' + r.errors.join(' ; ') : ''));
  show(decode);
}

await writeFile(join(ROOT, 'ci', 'showcase-results.xml'),
  junit(copies, registry, decode, registryRows));
console.log('wrote ci/showcase-results.xml');

const bad = [copies, registry, decode].filter(Boolean)
  .reduce((n, c) => n + c.failed.length + c.fixed.length, 0);
if (bad) { console.error(`\n${bad} failing checks`); process.exit(1); }
console.log('\nno new break: every check passes or is a known one');
