# Yup CMS — application image (read API + migration runner)
FROM node:22-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# App source.
COPY . .

EXPOSE 3000

# Default: run the read API. The compose "migrate" service overrides this.
CMD ["npm", "run", "api"]
