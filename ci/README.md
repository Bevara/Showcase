# Checking the demos

`check-demos.mjs` answers one question: does every demo on this site still
decode? It is meant to run on each change to this repository, before the
result is published, so a partial roll-out of a solver or an accessor is
caught here instead of on the live site.

## Why a demo breaks without anybody noticing

No page sets `script-directory`, so the tags resolve `using=` and `with=`
against the page's own directory. Every demo folder therefore carries its own
copy of the solver and of the accessors it names - `flv/` holds
`mm_solver_1.0.4.js`, `mm_solver_1.0.4.wasm`, `flvdmx_1.wasm`,
`ffmpeg-h26x_1.wasm`, `isobmff_1.wasm` and `libx264_1.wasm`. Copy a new solver
into some folders and not others, or bump a demo's `using=` without copying the
matching files, and that demo stops working while the rest of the site is fine.
Nothing in the page says so: the tag simply never produces an image.

## The two passes

**1. copies** - for each demo, check its folder actually contains
`<using>.js`, `<using>.wasm` and one `.wasm` per name in `with=`, plus any
source file the page references inside its own folder. No browser, runs in
under a second, and catches the partial-roll-out case on its own.

A source above the demo folder (`../test_sequences/...`) is skipped: that
directory is gitignored and filled by `get_testing_files.sh`, so its absence
says nothing about the commit under test.

**1b. registry** - each published accessor declares, in its `using` list, the
runtimes it was built against. A demo naming a runtime absent from that list is
broken by declaration whatever the files beside it look like: that is how the
`avif` demo asked `mm_solver_minimal_1.0.1` to load `avif_1` and `libaom_1`,
neither of which supports it. One HTTP request, no browser.

Accessors the registry has never heard of are reported separately, as JUnit
`skipped` rather than failures, because most of them still work - `libape_1`,
`libjbig2_1`, `libpoppler_1` and `libqoi_1` all do. They are worth seeing
anyway: nothing keeps a local-only build in step with the solver, which is how
`mkv` came to load an `ffdmx_1` from an older ABI and die on a missing stub.

Set `BEVARA_REGISTRY` to point elsewhere. If the registry cannot be reached the
pass is skipped rather than failed.

**2. decode** - serve the checkout and open each page in headless Chromium.
A `<video>`, `<audio>` or `<img>` tag counts as working when its
`decodingPromise` resolves *and* the result it points at is non-empty - the
promise alone resolves even when the source 404s, so the size check is the part
that matters. A `<canvas>` tag never settles, because it renders frame after
frame for as long as the page lives; and its pixels cannot be read either,
since the 3D demos render through WebGL and `getContext('2d')` returns null on
them. So a canvas is screenshotted and asked whether the image has more than
one colour, which separates a rendered scene from a blank element whatever the
context type.

Console errors, page errors and failed requests are collected per demo and
reported with the failure, so the JUnit entry says what went wrong rather than
just that something did.

## Running it

```sh
node ci/check-demos.mjs                  # serve this checkout (what CI does)
node ci/check-demos.mjs --copies-only    # pass 1 alone, no browser
node ci/check-demos.mjs --base https://bevara.github.io/Showcase
node ci/check-demos.mjs --only flv,mkv,vp9
node ci/check-demos.mjs --timeout 60000
```

It needs `puppeteer`. On the `filters-builder` agent Chromium is already in the
image and `CHROME_BIN` points at it, so `npm install --no-save puppeteer` with
`PUPPETEER_SKIP_DOWNLOAD=1` is enough; the script passes `CHROME_BIN` through to
`puppeteer.launch`.

It writes `ci/showcase-results.xml` in JUnit format and exits non-zero when any
check fails.

## The Jenkins job

A freestyle job, same shape as the `player` one.

- **Label**: `filters-builder` - that image already carries node, npm and
  Chromium.
- **Source**: this repository, branch `main`.
- **Trigger**: GitHub hook, or poll SCM. GitHub Pages publishes from `main`, so
  a push is what changes the site.
- **Build step** (shell):

  ```sh
  export PUPPETEER_SKIP_DOWNLOAD=1
  npm install --no-save puppeteer@22.15.0
  node ci/check-demos.mjs --timeout 60000
  ```

  Add `--base https://bevara.github.io/Showcase` as a second step if you also
  want the published site checked after Pages has caught up; it lags a push by
  a minute or so, so keep it separate from the pre-publish check rather than
  replacing it.

- **Post-build**: publish JUnit results from `ci/showcase-results.xml`. Each
  demo then shows up as its own test under `showcase.copies`,
  `showcase.registry` and `showcase.decode`, and a regression names the demo
  directly. `showcase.registry.unpublished` carries the warnings as skipped
  tests, so they stay visible without turning the build red.

`--disable-dev-shm-usage` is passed to Chromium by the script. A Kubernetes pod
gets 64 MB of `/dev/shm` by default and Chromium moves response bodies through
shared memory, which breaks fetches of a few hundred KB - the weight of most
media here - while leaving small ones alone.
