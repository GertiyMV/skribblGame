FROM node:24.14.0-alpine AS deps

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

FROM node:24.14.0-alpine AS builder

WORKDIR /workspace

COPY --from=deps /workspace/node_modules ./node_modules
COPY . .

RUN npm run build --workspace @skribbl/shared
RUN npm install --prefix apps/server
RUN npm run build --workspace @skribbl/server

FROM node:24.14.0-alpine AS dev

WORKDIR /workspace

COPY --from=deps /workspace/node_modules ./node_modules
COPY package.json ./package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /workspace/packages/shared/dist ./packages/shared/dist
COPY apps/server/package.json ./apps/server/package.json
COPY --from=builder /workspace/apps/server/dist ./apps/server/dist
RUN npm install --prefix apps/server

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO /dev/null http://localhost:3001/health || exit 1

CMD ["node", "apps/server/dist/index.js"]
