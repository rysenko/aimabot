FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

RUN mkdir -p data && chown node:node data

VOLUME ["/app/data"]

USER node

CMD ["node", "index.js"]
