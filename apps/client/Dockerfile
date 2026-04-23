FROM node:24.14.0-alpine AS deps

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

FROM node:24.14.0-alpine AS dev

WORKDIR /workspace

COPY --from=deps /workspace/node_modules ./node_modules
COPY . .
RUN npm run build --workspace @skribbl/shared
RUN npm install --prefix apps/client

EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD pgrep -f "tsc.*--watch" >/dev/null || exit 1

CMD ["npm", "run", "type-check", "--workspace", "@skribbl/client", "--", "--watch", "--preserveWatchOutput"]
