# The solvers, the accessors and the tag scripts are not part of the site: the
# pages load them from the Bevara registry at run time. get_testing_files.sh
# fetches the few the ServiceWorker packages carry inside their MP4 files.
FROM debian:bullseye

WORKDIR /var/www/html

# Install nginx and gpac (includes MP4Box)
RUN apt-get update && \
    apt-get install -y curl \
        nginx \
        gpac && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY . /var/www/html/

RUN ./get_testing_files.sh

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
