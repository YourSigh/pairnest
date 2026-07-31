FROM node:20-bookworm AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:20-bookworm AS runtime

ENV NODE_ENV=production \
    PAIRNEST_PORT=4000 \
    PAIRNEST_UPLOAD_DIR=/app/uploads

WORKDIR /app

# The Prisma CLI remains in the image because the same image is used by the
# one-shot "migrate" Compose service before the API starts.
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/scripts ./scripts

RUN mkdir -p /app/uploads \
    && chown -R node:node /app

USER node

EXPOSE 4000

CMD ["node", "dist/index.js"]
