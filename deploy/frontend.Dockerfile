FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 API_INTERNAL_URL=http://backend:8000
COPY --from=dependencies /app/node_modules ./node_modules
COPY frontend .
RUN npm run build
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 API_INTERNAL_URL=http://backend:8000
RUN groupadd --gid 10001 market && useradd --uid 10001 --gid 10001 --create-home market
COPY --from=build --chown=market:market /app/.next/standalone ./
COPY --from=build --chown=market:market /app/.next/static ./.next/static
COPY --from=build --chown=market:market /app/public ./public
USER market
EXPOSE 3000
CMD ["node", "server.js"]
