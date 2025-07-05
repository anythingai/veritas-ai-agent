# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN npm install -g pnpm && pnpm install
COPY . .
RUN pnpm run build

# Stage 2: Package
FROM alpine:3.22
WORKDIR /extension
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/manifest.json ./manifest.json
COPY --from=builder /app/assets ./assets
CMD ["/bin/sh"] 