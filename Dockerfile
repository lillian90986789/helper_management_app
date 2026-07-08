# ---------- 构建前端 ----------
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# ---------- 运行后端（含静态前端） ----------
FROM node:22-alpine
WORKDIR /app
# better-sqlite3 在 alpine 上需要编译工具
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install --omit=dev
COPY server/ ./server/
# 拷贝已构建的前端静态文件
COPY --from=web /web/dist ./web/dist

ENV PORT=8080
ENV DATA_DIR=/app/data
VOLUME /app/data
EXPOSE 8080
CMD ["node", "server/index.js"]
