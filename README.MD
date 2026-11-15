# Opening Browsers to New Formats with Dynamic Multimedia Pipelines

You can either serve these files statically (e.g python -m http.server) or use the current DockerFile to distribute these file through docker.

## The solvers and accessors are not in this repository

The `.wasm` files, and the `.js` half of each solver, come from the
[Bevara registry](https://registry.bevara.ddns.net) when the site is built.
Before serving a checkout, fetch them once:

```bash
node scripts/fetch-accessors.mjs
```

It reads from each page which solver and accessors its tags name, downloads
each distinct file once, checks it against the sha256 the registry publishes,
and places it where the page looks for it - next to the page. `accessors/`
receives the whole published set, with the registry's `index.json` and a
`fetched.json` recording the name, version and integrity of everything that was
fetched. The Pages workflow and the Dockerfile both run it.

`scripts/accessors.json` holds what a page cannot state: pages that build their
tags from JavaScript, and two lists that are debts. `local` names accessors the
registry does not publish, which therefore stay committed; `override` names
files a demo keeps from the repository because the published build does not
work there. Publishing the accessor retires the line.

`node scripts/fetch-accessors.mjs --check` writes nothing and reports which
files on disk are not the registry's.

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
