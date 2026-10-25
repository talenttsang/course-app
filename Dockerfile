# --- Build stage ---
FROM node:22.23.4-alpine AS builder
WORKDIR /app

# NEXT_PUBLIC_* values get inlined into the browser bundle during
# `next build`, so they must arrive as build args (Cloud Build passes
# them via cloudbuild.yaml substitutions). They are public by design —
# the anon key is safe to expose; the service role key is NOT and only
# ever gets set as a runtime env var on the Cloud Run service.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Runtime stage ---
FROM node:22.23.4-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Cloud Run injects PORT (default 8080); Next's standalone server honors it.
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
