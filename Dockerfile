FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

# 👇 Use legacy-peer-deps to ignore version conflicts
RUN npm install --legacy-peer-deps

COPY . .

EXPOSE 8080

# For Windows CMD — use this to bind to host IP
CMD ["npm", "start"]
