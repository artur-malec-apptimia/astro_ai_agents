FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY agent/ ./agent/

FROM oven/bun:1
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/agent ./agent

EXPOSE 3000
CMD ["bun", "run", "agent/index.ts"]
