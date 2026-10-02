# One reference to the base image, by tag and by digest: the tag says which line
# it follows, the digest which build of it this is, so a rebuild cannot pick up
# a different image unannounced. Dependabot moves both (.github/dependabot.yml).
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS node

FROM node AS base
RUN apk add --no-cache libc6-compat
RUN npm install -g pnpm@8.10.0

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Manifests first, so the install layer is reused until dependencies change.
# pnpm-workspace.yaml is required for the workspace: protocol to resolve.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# `packages/search` is deliberately absent. It was deleted in 1a397c5d and has
# no tracked files left; what remains on a developer's disk is gitignored build
# output. Both Dockerfiles still copied its manifest, so `docker compose build`
# failed at that line in any fresh clone — see the phase 12 notes.
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

# Rebuild the source code only when needed
FROM deps AS builder
WORKDIR /app

# Inherits root and per-package node_modules from deps; .dockerignore keeps the
# host's copies out of the build context so they cannot clobber them.
COPY . .

# turbo's dependsOn: ["^build"] builds @open-access-explorer/shared first
RUN pnpm build --filter=@open-access-explorer/web

# Production image, copy all the files and run next
FROM node AS runner
WORKDIR /app

# Kept from when this stage was built on `base`, which installs it.
RUN apk add --no-cache libc6-compat

# From `node` rather than `base`, so without the pnpm the build installs, and
# without the package managers the base image ships — npm, Corepack, Yarn.
# None of them runs here: the service is `node` and its own files. Left in,
# they were code in the image for a scan to report and an intruder to use, and
# pnpm 8.10.0 is old enough to carry advisories of its own.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# next.config.js traces from the workspace root, so the standalone bundle keeps
# the apps/web/ prefix: the entrypoint is apps/web/server.js and static assets
# must land in apps/web/.next/static.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# NOTE: apps/web has no public/ directory. If one is added, also copy it here:
#   COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
