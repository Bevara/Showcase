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