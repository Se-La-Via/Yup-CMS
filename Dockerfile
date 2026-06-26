# Yup CMS — production image (read API + migration runner).
# Multi-stage: build to JS with dev deps, then ship a lean runtime with prod
# deps only, running as a non-root user.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./package.json
USER node
EXPOSE 3000
# Default: run the read API. The compose "migrate" service overrides this.
CMD ["node", "dist/api/server.js"]
