// Everything this page loads is resolved against this script rather than the
// document, so it behaves the same whether it is included from the showcase
// home page or from a page of its own.
const HERE = document.currentScript.src;
// The accessor list is the one published with the Bevara Access build in
// sandbox/, which is kept in step with the binaries in accessors/.
const FILTER_LIST = new URL('../sandbox/assets/filter_list.json', HERE).href;
// Must be absolute: the tag does not resolve a relative script-directory
// against the document, and silently falls back to a plain tag instead.
const SCRIPT_DIRECTORY = new URL('../accessors/', HERE).href;
const MEDIAINFO_WASM = new URL('MediaInfoModule.wasm', HERE).href;
// The showcase demos pair the light solver with the still-picture and
// sound tags, and the full one with the tags the compositor drives.
const SOLVER = { img: 'solver_minimal_1', audio: 'solver_minimal_1', canvas: 'solver_1' };

const el = (id) => document.getElementById(id);
const drop = el('drop');
const fileInput = el('file');

// name -> id ("libwebp" -> "libwebp_1"), plus the two recommendation
// indexes the Bevara Access editor builds from the same descriptors.
let idOf = {};
let byFormat = {};   // accessor name -> [format, ...]
let byExtension = {}; // extension -> { accessors: [name, ...], tag }

const listReady = fetch(FILTER_LIST)
    .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
    })
    .then((list) => {
        for (const [asset, filter] of Object.entries(list)) {
            idOf[filter.name] = asset.replace(/\.wasm$/, '');
            if (filter.Format) byFormat[filter.name] = filter.Format;
            for (const [ext, tag] of Object.entries(filter.extension || {})) {
                const entry = (byExtension[ext] ??= { accessors: [], tag });
                entry.accessors.push(filter.name);
            }
        }
    });

let mediainfo = null;
async function analyse(file) {
    if (!mediainfo) {
        mediainfo = await MediaInfo.mediaInfoFactory({
            format: 'JSON',
            locateFile: () => MEDIAINFO_WASM,
        });
    }
    const readChunk = (size, offset) =>
        file.slice(offset, offset + size).arrayBuffer().then((b) => new Uint8Array(b));
    try {
        const result = JSON.parse(await mediainfo.analyzeData(() => file.size, readChunk));
        return result.media?.track ?? [];
    } catch {
        return [];
    }
}

// Same rule as LibrariesService.setRecommended: an accessor is picked when
// one of its declared formats matches a track, or when it claims the
// file extension.
function accessorsFor(tracks, ext) {
    const names = new Set();
    for (const [name, formats] of Object.entries(byFormat)) {
        if (tracks.some((t) => formats.includes(t.Format))) names.add(name);
    }
    for (const name of byExtension[ext]?.accessors ?? []) names.add(name);
    return [...names].map((n) => idOf[n]).filter(Boolean).sort();
}

// Same rule as TagsService.setRecommended: a video track goes to the
// canvas the compositor draws into.
function tagFor(tracks, ext) {
    if (tracks.some((t) => t['@type'] === 'Video')) return 'canvas';
    if (tracks.some((t) => t['@type'] === 'Image')) return 'img';
    if (tracks.some((t) => t['@type'] === 'Audio')) return 'audio';
    const tag = byExtension[ext]?.tag ?? null;
    return tag === 'video' ? 'canvas' : tag;
}

function buildTag(tag, url, accessors) {
    // The compositor reads data-url, and only from an absolute address
    const source = tag === 'canvas' ? 'data-url' : 'src';
    const controls = tag === 'audio' ? ' controls' : '';
    const open = `<${tag} is="universal-${tag}_1" ${source}="${url}" using="${SOLVER[tag]}" ` +
        `with="${accessors.join(';')}" script-directory="${SCRIPT_DIRECTORY}"${controls}>`;
    // <img> is void: giving it a closing tag would be invalid markup.
    return tag === 'img' ? open : `${open}</${tag}>`;
}

function setVerdict(kind, text) {
    const v = el('verdict');
    v.className = `verdict ${kind}`;
    v.textContent = text;
}

// A dropped file and a URL differ in one place only: what the tag is
// finally pointed at. MediaInfo needs the bytes either way, so a URL is
// fetched once here — which also settles whether it is reachable at all.
async function fromFile(file) {
    return { name: file.name, size: file.size, blob: file, url: URL.createObjectURL(file), local: true };
}

async function fromUrl(raw) {
    const url = new URL(raw, location.href).href;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const blob = await response.blob();
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop()) || 'source';
    return { name, size: blob.size, blob, url, local: false };
}

let currentUrl = null;
async function test(source) {
    el('report').hidden = false;
    el('preview-section').hidden = true;
    el('preview').replaceChildren();
    if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
        currentUrl = null;
    }

    const ext = (source.name.split('.').pop() || '').toLowerCase();
    el('r-file').textContent = `${source.name} — ${(source.size / 1024).toFixed(0)} KB`;
    el('r-format').textContent = 'analysing…';
    el('r-libs').textContent = '';
    el('r-tag').textContent = '';
    el('r-solver').textContent = '';
    el('snippet').textContent = '';
    setVerdict('busy', 'Reading the file…');

    try {
        await listReady;
    } catch (err) {
        setVerdict('no', `The accessor list could not be loaded (${err.message}).`);
        el('r-format').textContent = '';
        return;
    }

    const tracks = await analyse(source.blob);
    const formats = [...new Set(tracks.map((t) => t.Format).filter(Boolean))];
    el('r-format').textContent = formats.length ? formats.join(', ') : 'not recognised by MediaInfo';

    const accessors = accessorsFor(tracks, ext);
    const tag = tagFor(tracks, ext);
    el('r-libs').textContent = accessors.length ? accessors.join(', ') : 'none';
    el('r-tag').textContent = tag ? `<${tag} is="universal-${tag}_1">` : 'undetermined';
    el('r-solver').textContent = tag ? SOLVER[tag] : '';

    if (accessors.length === 0 || !tag) {
        setVerdict('no', 'This format is not supported yet. Write to support@bevara.com to ask about ' +
            'support options, or add the accessor yourself with the Bevara Access IDE.');
        return;
    }

    if (tag === 'canvas' && source.local) {
        setVerdict('no', 'This is a video, and a video cannot be decoded from a dropped file: ' +
            'Put the file somewhere reachable over https and paste its address above.');
        return;
    }

    if (source.local) currentUrl = source.url;
    const markup = buildTag(tag, source.url, accessors);
    el('snippet').textContent = buildTag(tag, source.name, accessors);

    // A plain element first: a browser that already reads the format would
    // display the preview on its own, and the accessors would get the
    // credit for work they never did.
    setVerdict('busy', 'Analyzing the format and finding the right combination of accessors…');
    const native = await browserHandles(source.url, tag);

    setVerdict('busy', `Decoding with ${accessors.join(', ')} on ${SOLVER[tag]}…`);
    el('preview-section').hidden = false;
    const host = document.createElement('div');
    host.innerHTML = markup;
    el('preview').replaceChildren(host);

    // decodingPromise is not a verdict: it settles with the source when the
    // tag steps aside, and resolves empty on formats that still display.
    // What the element ends up holding is the only dependable signal.
    const node = host.firstElementChild;
    const decoded = await waitForOutput(node, tag);

    if (decoded && !native) {
        setVerdict('ok', `Supported — decoded with ${accessors.join(', ')}.`);
    } else if (decoded) {
        setVerdict('ok', 'Your browser already reads this format on its own.' +
            `Bevara matters here for browsers that do not.`);
    } else {
        setVerdict('no', `${accessors.join(', ')} claims this format but produced nothing. ` +
            'That is an interesting finding. Can you report the file to support@bevara.com?');
    }
}

// Renders the file in an ordinary element, away from the page, to find
// out whether the browser needs Bevara for this format at all.
async function browserHandles(url, tag) {
    // An ordinary <canvas> displays nothing on its own; what we want to
    // know is whether the browser reads the format, so ask a <video>.
    const probe = document.createElement(tag === 'canvas' ? 'video' : tag);
    if (tag === 'canvas') tag = 'video';
    if (tag !== 'img') probe.muted = true;
    probe.hidden = true;
    probe.src = url;
    document.body.appendChild(probe);
    const handled = await waitForOutput(probe, tag, 6000);
    probe.remove();
    return handled;
}

// Polls the element until it holds something. A media element reaches
// readyState 1 on its audio track alone, so a video is judged on the
// frame size: an Ogg whose Theora track never decodes still reports
// readyState 4 from its Vorbis track.
function waitForOutput(node, tag, timeout = 30000) {
    const done = () => {
        if (tag === 'img') return node.naturalWidth > 0;
        if (tag === 'video') return node.videoWidth > 0;
        // A canvas nothing has drawn into keeps the 300x150 default; the
        // compositor sizes it once it knows the video.
        if (tag === 'canvas') return node.width !== 300 || node.height !== 150;
        return node.readyState > 0;
    };
    return new Promise((resolve) => {
        const started = Date.now();
        const tick = () => {
            if (done()) return resolve(true);
            if (Date.now() - started > timeout) return resolve(false);
            setTimeout(tick, 250);
        };
        tick();
    });
}

drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
    }
});
async function testFile(file) {
    test(await fromFile(file));
}

fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) testFile(fileInput.files[0]);
});

el('url-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = el('url').value.trim();
    if (!raw) return;
    el('report').hidden = false;
    el('preview-section').hidden = true;
    setVerdict('busy', 'Fetching the address…');
    try {
        test(await fromUrl(raw));
    } catch (err) {
        // A cross-origin address without CORS headers is unreadable here,
        // and the accessors would not reach it either.
        setVerdict('no', `That address could not be read (${err.message}). It must be reachable ` +
            'and, if it sits on another server, allow cross-origin requests.');
    }
});
for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (e) => {
        e.preventDefault();
        drop.classList.add('over');
    });
}
for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, (e) => {
        e.preventDefault();
        drop.classList.remove('over');
    });
}
drop.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) testFile(file);
});
