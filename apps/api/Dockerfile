FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/search/package.json ./packages/search/
COPY apps/api/package.json ./apps/api/

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared ./packages/shared
COPY packages/search ./packages/search
COPY apps/api ./apps/api

# Build packages
RUN pnpm build

# Expose port
EXPOSE 4000

# Start the application
CMD ["pnpm", "start", "--filter=api"]
