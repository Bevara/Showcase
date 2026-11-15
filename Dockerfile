# The solvers and accessors are not in the repository: fetch them from the
# Bevara registry first (scripts/fetch-accessors.mjs needs Node 18 or later,
# which Debian bullseye does not package).
FROM node:20-bookworm-slim AS accessors
WORKDIR /site
COPY . .
RUN node scripts/fetch-accessors.mjs

FROM debian:bullseye

WORKDIR /var/www/html

# Install nginx and gpac (includes MP4Box)
RUN apt-get update && \
    apt-get install -y curl \
        nginx \
        gpac && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY --from=accessors /site /var/www/html/

RUN ./get_testing_files.sh

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
