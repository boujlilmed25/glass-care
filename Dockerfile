FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p _data
ENV PORT=8080
CMD ["node", "server.js"]
