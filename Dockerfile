FROM node:24.21.0-bookworm-slim
WORKDIR /app
COPY package.json config.json app.mjs Cloud_Update.mjs ./
COPY lib ./lib
RUN mkdir -p cache output && chown -R node:node /app
USER node
CMD ["node", "Cloud_Update.mjs"]
