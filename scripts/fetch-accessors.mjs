#!/usr/bin/env node
/*
 * Fetches the solvers, the accessors and the tag scripts the demos need from
 * the Bevara registry.
 *
 * The .wasm files (and each solver's .js, which is the other half of the same
 * artefact) used to be committed: 340 binaries, 436 MB, for 94 distinct files,
 * copied by hand into every demo folder and drifting there - pgf/ carried its
 * own libpgf and its own minimal solver, rgbyuv was a version behind the
 * registry everywhere. They are no longer in the repository. The Pages
 * workflow runs this script before publishing, and so does anybody who wants
 * to serve the site locally:
 *
 *     node scripts/fetch-accessors.mjs
 *
 * What each demo needs is read from its page, not from a list: a tag
 *
 *     <video is="universal-video_1" using="mm_solver_1.0.6" with="flvdmx_1;libx264_1">
 *
 * needs mm_solver_1.0.6.js, mm_solver_1.0.6.wasm, flvdmx_1.wasm and
 * libx264_1.wasm next to the page, because no page sets script-directory and
 * the tags then resolve those names against the page's own directory. A tag
 * whose script-directory is an absolute URL loads from there and needs nothing
 * here. The tag scripts themselves (universal-video_1.js and the others) are
 * taken the same way, wherever a page's <script src> points: the registry is
 * where a fix to them is published, and a copy kept here is how the site came
 * to run a version the registry did not have. scripts/accessors.json covers
 * what no tag states: pages that build
 * their tags from JavaScript, the ServiceWorker packages, and accessors/, the
 * local mirror that test/ and sandbox/ read.
 *
 * Every download is checked against the sha256 the registry publishes for it,
 * and a file that fails the check is not written. Accessors the registry does
 * not publish cannot be fetched: those stay committed, are listed in
 * accessors.json, and the script fails if one of them is missing rather than
 * publish a demo without its decoder.
 *
 * What was fetched - name, version, integrity - is written to
 * accessors/fetched.json, so the published site says which registry builds it
 * is made of.
 *
 *     --registry <url>   another registry (default https://registry.bevara.ddns.net)
 *     --check            download and verify, write nothing, report what differs
 *     --quiet            only problems and the summary
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf('--' + n); return i < 0 ? d : (argv[i + 1] ?? true); };
const REGISTRY = String(flag('registry', process.env.BEVARA_REGISTRY || 'https://registry.bevara.ddns.net')).replace(/\/+$/, '');
const CHECK = argv.includes('--check');
const QUIET = argv.includes('--quiet');
const log = (...a) => { if (!QUIET) console.log(...a); };

const config = JSON.parse(await readFile(join(ROOT, 'scripts', 'accessors.json'), 'utf8'));

/* ---------- the registry ---------- */

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.json();
}

const index = await getJSON(`${REGISTRY}/accessors/index.json`);

/* file name -> where it comes from. Accessors are published under an ABI
 * name (libpng_1.wasm) and the index lists the current release of each. */
const published = new Map();
for (const f of index.filters || []) {
  published.set(f.file, { url: f.url, integrity: f.integrity, name: f.name, version: f.version, emsdk: f.emsdk ?? null });
}

/* The scripts that define the elements, published as one package. */
const tagScripts = new Map();
for (const t of index.tags || []) {
  tagScripts.set(t.file, { file: t.file, url: t.url, integrity: t.integrity, name: t.name, version: t.version });
}

/* A solver's name carries its version (mm_solver_1.0.6), and a page may name
 * one that is no longer the latest: versions are immutable in the registry,
 * so an older one is still there, described by its own document. */
const solverCache = new Map();
async function solverFiles(module) {
  if (solverCache.has(module)) return solverCache.get(module);
  const m = /^(mm_solver(?:_[a-z]+)*)_(\d+\.\d+\.\d+)$/.exec(module);
  if (!m) throw new Error(`"${module}" is not a solver name (expected mm_solver[_variant]_X.Y.Z)`);
  const name = 'bevara:' + m[1], version = m[2];
  const latest = (index.runtimes || []).find(r => r.name === name && r.version === version);
  let files;
  if (latest) {
    files = [
      { file: latest.file, url: latest.url, integrity: latest.integrity },
      { file: latest.js, url: latest.jsUrl, integrity: latest.jsIntegrity }
    ];
  } else {
    const doc = await getJSON(`${REGISTRY}/filters/${encodeURIComponent(name)}/${version}`);
    files = [
      { file: doc.dist.file, url: doc.dist.wasm, integrity: doc.dist.integrity },
      { file: doc.dist.jsFile, url: doc.dist.js, integrity: doc.dist.jsIntegrity }
    ];
  }
  for (const f of files) Object.assign(f, { name, version, emsdk: latest?.emsdk ?? null });
  solverCache.set(module, files);
  return files;
}

/* ---------- what the site needs ---------- */

const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', 'ci']);
async function htmlFiles(dir = ROOT, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.') { if (SKIP_DIRS.has(e.name) || e.isDirectory()) continue; }
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await htmlFiles(join(dir, e.name), out); }
    else if (e.name.endsWith('.html')) out.push(join(dir, e.name));
  }
  return out;
}

const attr = (tag, name) => { const m = new RegExp('\\b' + name + '="([^"]*)"', 'i').exec(tag); return m ? m[1] : null; };

/* directory (relative to the repository) -> Set of module names, solvers and
 * accessors alike, as pages spell them: "mm_solver_1.0.6", "libpng_1". */
const needs = new Map();
const need = (dir, module) => { if (!needs.has(dir)) needs.set(dir, new Set()); needs.get(dir).add(module); };

for (const page of await htmlFiles()) {
  const html = await readFile(page, 'utf8');
  const here = relative(ROOT, dirname(page)) || '.';
  /* Real elements only: the pages also show their own markup as text, with
   * &lt; for the angle bracket, and that must not count as a demand. */
  for (const m of html.matchAll(/<(?:video|audio|img|canvas)\b[^>]*?\busing="([^"]+)"[^>]*>/gis)) {
    const tag = m[0];
    const sd = attr(tag, 'script-directory');
    if (sd && /^https?:/i.test(sd)) continue;                 // loads straight from a URL
    const dir = sd ? (relative(ROOT, resolve(dirname(page), sd)) || '.') : here;
    need(dir, m[1]);
    for (const a of (attr(tag, 'with') || '').split(';').map(s => s.trim()).filter(Boolean)) need(dir, a);
  }
}

/* The tag scripts, wherever a page takes them from. */
const scriptNeeds = new Map();    // dir -> Set(file)
const needScript = (dir, file) => { if (!scriptNeeds.has(dir)) scriptNeeds.set(dir, new Set()); scriptNeeds.get(dir).add(file); };
for (const page of await htmlFiles()) {
  const html = await readFile(page, 'utf8');
  for (const m of html.matchAll(/<script\b[^>]*?\bsrc="([^"]+)"/gi)) {
    const src = m[1].split(/[?#]/)[0];
    if (/^(https?:)?\/\//i.test(src)) continue;
    const file = src.split('/').pop();
    if (!tagScripts.has(file)) continue;
    needScript(relative(ROOT, dirname(resolve(dirname(page), src))) || '.', file);
  }
}
if (config.mirror) for (const file of tagScripts.keys()) needScript(config.mirror, file);

/* Pages that build their tags in JavaScript name the accessors on a
 * placeholder instead: <div class="slot" data-with="ogg_1;theora_1">. Those
 * need the accessors next to the page too, and the solver the placeholder
 * names with data-using, or the current full one. webcodec/ lost its decoders
 * when the binaries left the repository because this was not read. */
const slotNeeds = [];
for (const page of await htmlFiles()) {
  const html = await readFile(page, 'utf8');
  const here = relative(ROOT, dirname(page)) || '.';
  for (const m of html.matchAll(/<[a-z][a-z0-9-]*\b[^>]*?\bdata-with="([^"]+)"[^>]*>/gi)) {
    const using = attr(m[0], 'data-using');
    slotNeeds.push({ dir: here, using: using || '@mm_solver', with: m[1].split(';').map(s => s.trim()).filter(Boolean) });
  }
}

/* What no tag states. */
const currentSolver = (name) => {
  const rt = (index.runtimes || []).find(r => r.name === 'bevara:' + name);
  if (!rt) throw new Error(`scripts/accessors.json asks for @${name}, which the registry does not publish`);
  return rt.file.replace(/\.wasm$/, '');
};
for (const [dir, modules] of Object.entries(config.extra || {})) {
  for (const mod of modules) need(dir, mod.startsWith('@') ? currentSolver(mod.slice(1)) : mod);
}
for (const slot of slotNeeds) {
  need(slot.dir, slot.using.startsWith('@') ? currentSolver(slot.using.slice(1)) : slot.using);
  for (const a of slot.with) need(slot.dir, a);
}
if (config.mirror) {
  for (const f of index.filters || []) need(config.mirror, f.file.replace(/\.wasm$/, ''));
  for (const r of index.runtimes || []) need(config.mirror, r.file.replace(/\.wasm$/, ''));
}

/* ---------- fetch, verify, place ---------- */

const sha256 = (buf) => 'sha256-' + createHash('sha256').update(buf).digest('base64');
const cache = new Map();          // url -> Promise<Buffer>
function download(src) {
  if (!cache.has(src.url)) {
    cache.set(src.url, (async () => {
      const r = await fetch(src.url);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${src.url}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (src.integrity && sha256(buf) !== src.integrity) {
        throw new Error(`integrity mismatch for ${src.file}: the registry announces ${src.integrity}, the download is ${sha256(buf)}`);
      }
      return buf;
    })());
  }
  return cache.get(src.url);
}

const local = new Set(config.local || []);     // committed, because the registry does not publish them
/* dir/file pairs kept from the repository although the registry has that name,
 * because the published build is known not to work there. */
const overridden = new Map();
for (const [dir, o] of Object.entries(config.override || {})) for (const f of o.files) overridden.set(dir + '/' + f, o.why);
const kept = [];
const problems = [];
const placed = [];                // { dir, file }
const fetched = new Map();        // file -> provenance
const different = [];             // --check: files on disk that are not the registry's

async function place(dir, src) {
  const dest = join(ROOT, dir, src.file);
  if (overridden.has(dir + '/' + src.file)) {
    if (!existsSync(dest)) problems.push(`${dir}/${src.file}: overridden in scripts/accessors.json but missing from the repository`);
    else kept.push(`${dir}/${src.file}`);
    return;
  }
  const buf = await download(src);
  fetched.set(src.file, { file: src.file, name: src.name, version: src.version, integrity: src.integrity ?? null, emsdk: src.emsdk ?? null });
  if (CHECK) {
    if (!existsSync(dest)) different.push(`${dir}/${src.file}: absent`);
    else if (sha256(await readFile(dest)) !== sha256(buf)) different.push(`${dir}/${src.file}: differs from the registry's ${src.name}@${src.version}`);
    return;
  }
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  placed.push({ dir, file: src.file });
}

const jobs = [];
for (const [dir, modules] of [...needs].sort()) {
  for (const module of [...modules].sort()) {
    jobs.push(async () => {
      try {
        if (/^mm_solver/.test(module)) {
          for (const f of await solverFiles(module)) await place(dir, f);
          return;
        }
        const file = module + '.wasm';
        const src = published.get(file);
        if (src) { await place(dir, { file, ...src }); return; }
        /* Not published. It has to be one of the committed ones, and present. */
        if (!local.has(file)) {
          problems.push(`${dir}/${file}: the registry does not publish it and scripts/accessors.json does not list it as local`);
        } else if (!existsSync(join(ROOT, dir, file))) {
          problems.push(`${dir}/${file}: listed as local (not published) but missing from the repository`);
        }
      } catch (e) {
        problems.push(`${dir}/${module}: ${e.message}`);
      }
    });
  }
}

for (const [dir, files] of [...scriptNeeds].sort()) {
  for (const file of [...files].sort()) {
    jobs.push(async () => {
      try { await place(dir, tagScripts.get(file)); }
      catch (e) { problems.push(`${dir}/${file}: ${e.message}`); }
    });
  }
}

/* A few at a time: 300-odd placements, ninety-odd distinct downloads. */
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => { while (next < jobs.length) await jobs[next++](); }));

/* ---------- report ---------- */

if (!CHECK && config.mirror && !problems.length) {
  const out = {
    registry: REGISTRY,
    checkpoint: index.checkpoint?.seq ?? null,
    generated: index.generated ?? null,
    fetchedAt: new Date().toISOString(),
    files: [...fetched.values()].sort((a, b) => a.file.localeCompare(b.file))
  };
  await writeFile(join(ROOT, config.mirror, 'fetched.json'), JSON.stringify(out, null, 2) + '\n');
  /* The registry's own index, next to the files it describes: which accessor
   * decodes what, and which solvers each one loads with. A page that composes
   * pipelines can read it instead of a list frozen at some earlier build. */
  await writeFile(join(ROOT, config.mirror, 'index.json'), JSON.stringify(index) + '\n');
}

const dirs = new Set(placed.map(p => p.dir));
if (CHECK) {
  for (const d of different.sort()) console.log('  ' + d);
  console.log(`\nchecked ${fetched.size} distinct files against ${REGISTRY}: ${different.length} placement${different.length === 1 ? '' : 's'} would change`);
} else {
  log(`fetched ${fetched.size} distinct files from ${REGISTRY} (checkpoint ${index.checkpoint?.seq ?? '?'}), placed ${placed.length} copies in ${dirs.size} directories`);
  if (kept.length) log(`kept from the repository instead of the registry (scripts/accessors.json, "override"): ${kept.sort().join(', ')}`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length > 1 ? 's' : ''}:`);
  for (const p of problems.sort()) console.error('  ' + p);
  process.exit(1);
}
