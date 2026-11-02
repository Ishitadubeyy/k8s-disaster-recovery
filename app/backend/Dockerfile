FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY schema.sql ./schema.sql
COPY src ./src

USER node
EXPOSE 3001
CMD ["npm", "start"]
