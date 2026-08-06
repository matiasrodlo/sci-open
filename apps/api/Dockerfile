FROM node:18-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Manifests first, so the install layer is reused until dependencies change.
# pnpm-workspace.yaml is required for the workspace: protocol to resolve, and
# every workspace member's manifest must be present for --frozen-lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/search/package.json ./packages/search/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code (apps/web is not needed to build the API)
COPY packages/shared ./packages/shared
COPY packages/search ./packages/search
COPY apps/api ./apps/api

# turbo's dependsOn: ["^build"] builds shared and search first
RUN pnpm build --filter=@open-access-explorer/api

# Expose port
EXPOSE 4000

# Start the application
CMD ["node", "apps/api/dist/index.js"]
