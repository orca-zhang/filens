# Illustrative container recipe for static reading-room pages.
FROM nginx:1.28-alpine

LABEL org.opencontainers.image.title="Shoreline Reading Room"
LABEL org.opencontainers.image.description="Fictional community reading-room site"

COPY public/ /srv/reading-room/
COPY studio.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
