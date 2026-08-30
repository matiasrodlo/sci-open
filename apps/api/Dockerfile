# Built in the image of apps/web/Dockerfile, which was already right: multiple
# stages, a production-only install in the runner, a non-root user, and a
# healthcheck. The previous version was a single stage that ran as root and
# shipped devDependencies, TypeScript sources and the whole build toolchain
# into production.
FROM node:22-alpine AS base
RUN npm install -g pnpm@8.10.0

FROM base AS deps
WORKDIR /app

# Manifests first, so the install layer is reused until dependencies change.
# pnpm-workspace.yaml is required for the workspace: protocol to resolve, and
# every workspace member's manifest must be present for --frozen-lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
# `packages/search` is deliberately absent. It was deleted in 1a397c5d and has
# no tracked files left; what remains on a developer's disk is gitignored build
# output. Both Dockerfiles still copied its manifest, so `docker compose build`
# failed at that line in any fresh clone — see the phase 12 notes.
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

FROM deps AS builder
WORKDIR /app

# apps/web is not needed to build the API.
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# turbo's dependsOn: ["^build"] builds shared and search first.
RUN pnpm build --filter=@open-access-explorer/api

# `pnpm deploy` produces a self-contained tree for one workspace package:
# its own files plus a node_modules with the workspace dependencies injected
# rather than symlinked. It is the tool pnpm provides for exactly this, and it
# is what keeps the other workspace projects out.
#
# The two approaches tried first both failed to, and the numbers are worth
# keeping: installing `--prod` on top of the dev stage left pnpm's store intact
# at 566 MB with eslint, tsc and turbo still on the PATH; and a clean
# `--prod --filter "@open-access-explorer/api..."` still hydrated the whole
# store from the shared lockfile, leaving Next.js and its two SWC binaries —
# 345 MB — in an image that never runs them.
FROM builder AS deploy
WORKDIR /app
RUN pnpm deploy --filter=@open-access-explorer/api --prod /out


FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Runs as a real user rather than root. The uid matches the web image's so a
# shared volume, if one ever appears, is not owned by two different users.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 fastify

# Only what the service needs at runtime. `pnpm deploy` has already flattened
# the layout, so the entrypoint is dist/index.js at the root rather than under
# apps/api/.
COPY --from=deploy --chown=fastify:nodejs /out ./

USER fastify

EXPOSE 4000

# `/health` is already served and takes no dependencies, so it answers even
# while Redis or an upstream provider is down — which is what a liveness probe
# should report on.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
