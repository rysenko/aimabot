FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY . .

VOLUME ["/app/data"]

ENV NODE_ENV=production

EXPOSE 3000

USER node

CMD ["npm", "start"]