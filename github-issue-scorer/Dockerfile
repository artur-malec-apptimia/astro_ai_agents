FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/main.ts ./
COPY --from=builder /app/package.json ./
RUN chown -R bun:bun /app
USER bun
CMD ["bun", "run", "main.ts"]
