# Opening Browsers to New Formats with Dynamic Multimedia Pipelines

You can either serve these files statically (e.g python -m http.server) or use the current DockerFile to distribute these file through docker.

## The solvers and accessors come from the registry

The `.wasm` files, the `.js` half of each solver and the tag scripts
(`universal-*_1.js`) are not part of the site: every page loads them at run
time from the [Bevara registry](https://registry.bevara.ddns.net), which
serves them with `Access-Control-Allow-Origin: *`. A demo's tag reads

```html
<img is="universal-img_1" registry="https://registry.bevara.ddns.net" force
     src="Freedom.png" using="mm_solver_minimal_1.0.1" with="libpng_1">
<script src="https://registry.bevara.ddns.net/accessors/universal-img_1.js"></script>
```

`registry` is where the tag fetches the solver (`using`) and the accessors
(`with`). Without `force`, the tag first lets the browser decode the source
itself and fetches nothing when it can; the demos set `force`, since their
point is to show the Bevara pipeline at work, natively decodable formats
included.

`script-directory` still works and is looked in first. The few accessors the
registry does not publish stay committed next to the demo that uses them, and
that demo's tag adds `script-directory="./"`: `ape`, `jbig2`, `mkv` (ffdmx),
`pdf` (poppler) and `qoi`, plus `pgf`, which keeps its own `libpgf_1` and
minimal solver because the published libpgf needs a symbol that solver does
not export. `accessors/` keeps the unpublished ones the tester can offer
(`scripts/local-accessors.json` describes them). Each of these is a debt:
publishing the accessor retires it.

A checkout is therefore served as is - nothing to fetch first. The exception is
the ServiceWorker demo: its MP4 files carry their own page, tag script, solver
and accessors, which is the point of that demo, and `get_testing_files.sh`
fetches from the registry the ones each `content.html` names while it builds
them.

## Using this material through docker 

Make sure you have Docker installed on your system.

Run this command in the folder that contains the `Dockerfile` :

```bash
docker build -t showcase .
```

Then start the container and map to a port (e.g. port 8000):

```bash
docker run -p 8000:80 showcase
```

The demo will be available at:
http://localhost:8000
