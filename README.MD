# Opening Browsers to New Formats with Dynamic Multimedia Pipelines

You can either serve these files statically (e.g python -m http.server) or use the current DockerFile to distribute these file through docker.

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
