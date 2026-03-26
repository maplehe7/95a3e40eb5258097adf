FROM node:20-alpine

WORKDIR /app

LABEL org.opencontainers.image.title="Holy Unblocker LTS" \
      org.opencontainers.image.description="An effective, privacy-focused web proxy service" \
      org.opencontainers.image.version="6.9.4" \
      org.opencontainers.image.authors="Holy Unblocker Team" \
      org.opencontainers.image.source="https://github.com/QuiteAFancyEmerald/Holy-Unblocker/"

ARG WIREPROXY_VERSION=v1.1.2

RUN apk add --no-cache tor bash curl tar && \
    arch="$(apk --print-arch)" && \
    case "$arch" in \
      x86_64) wireproxy_arch="amd64" ;; \
      aarch64) wireproxy_arch="arm64" ;; \
      *) echo "Unsupported architecture for wireproxy: $arch" >&2; exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/windtf/wireproxy/releases/download/${WIREPROXY_VERSION}/wireproxy_linux_${wireproxy_arch}.tar.gz" | \
      tar -xz -C /usr/local/bin wireproxy && \
    chmod +x /usr/local/bin/wireproxy

COPY . .

RUN npm run fresh-install
RUN npm run build

EXPOSE 8080 9050 9051

COPY serve.sh /serve.sh
RUN chmod +x /serve.sh

CMD ["/serve.sh"]
