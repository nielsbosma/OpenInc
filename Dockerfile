# One image for the whole app: web, API, MCP and the job worker.
#   docker run -p 3000:3000 -e DATABASE_URL=... -e S3_BUCKET=... -e S3_ACCESS_KEY=... -e S3_SECRET_KEY=... -e APP_SECRET=... ghcr.io/nielsbosma/openinc
# ROLE=web or ROLE=worker runs only one half; the default runs both in one process.

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @openinc/web build

FROM base AS runtime
# pg_dump backs the database up to the bucket before migrations; it must be at least the server's major version.
RUN apk add --no-cache tini postgresql18-client
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile --filter "@openinc/server..." \
 && rm -rf /root/.cache /root/.local/share/pnpm
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/server ./apps/server
COPY --from=build /app/apps/web/dist ./apps/web/dist

ARG OPENINC_VERSION=0.0.0-dev
ENV NODE_ENV=production OPENINC_VERSION=$OPENINC_VERSION PORT=3000
USER node
WORKDIR /app/apps/server
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--import", "tsx", "src/main.ts"]
