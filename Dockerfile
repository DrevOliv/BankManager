# syntax=docker/dockerfile:1

# ---- Build the React frontend ----
FROM node:24-bookworm-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- Build the API ----
FROM node:24-bookworm-slim AS server
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---- Runtime ----
FROM node:24-alpine
RUN apk add --no-cache tzdata
ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Europe/Stockholm \
    WEB_DIST=/app/web/dist
WORKDIR /app/server
COPY --from=server /app/server/package.json ./
COPY --from=server /app/server/node_modules ./node_modules
COPY --from=server /app/server/dist ./dist
COPY --from=web /app/web/dist /app/web/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]
