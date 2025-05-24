FROM node:24-bookworm AS builder

WORKDIR /data

COPY ./ /data

RUN corepack enable pnpm && \
    pnpm install && \
    pnpm run generate

FROM nginxinc/nginx-unprivileged:stable-alpine-slim
COPY --from=builder /data/.output/public /usr/share/nginx/html

