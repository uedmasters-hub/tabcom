# ─── Tabcom realtime backend ─────────────────────────────────────────
# Runs on any container host: Koyeb, Fly.io, Railway, Render.
#
# NOT deployable to Vercel or Netlify. Socket.IO needs a long-lived
# process holding open WebSocket connections; serverless functions are
# torn down between requests and cannot do that.
#
# Build context is the MONOREPO ROOT (pnpm workspace resolution needs
# every workspace manifest present, or --frozen-lockfile fails):
#   docker build -f apps/backend/Dockerfile -t tabcom-backend .
# ──────────────────────────────────────────────────────────────────────

FROM node:22-slim

# Pin pnpm to the version in the root package.json so lockfile
# resolution matches local exactly.
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

WORKDIR /app

# Manifests first — this layer caches until dependencies change.
# All workspace package.json files are required for --frozen-lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/backend/package.json    apps/backend/
COPY apps/extension/package.json  apps/extension/
COPY apps/mobile/package.json     apps/mobile/
COPY packages/shared/package.json packages/shared/

# --filter installs only what the backend needs; the extension's and
# mobile app's dependency trees never get downloaded.
# --ignore-scripts skips the extension's `wxt prepare` postinstall,
# which would fail here since its source isn't in the image.
RUN pnpm install --filter @tabcom/backend --frozen-lockfile --ignore-scripts

COPY apps/backend apps/backend

# Fail the BUILD rather than the deploy if types are broken.
RUN pnpm --filter @tabcom/backend run typecheck

ENV NODE_ENV=production
# Koyeb/Fly/Railway inject PORT; the server already reads process.env.PORT.
ENV PORT=8000
EXPOSE 8000

CMD ["pnpm", "--filter", "@tabcom/backend", "run", "start"]
