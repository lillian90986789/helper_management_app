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
# better-sqlite3 在 alpine 上需要编译工具；tzdata 提供命名时区（否则 TZ=Asia/Singapore 无法解析）
RUN apk add --no-cache python3 make g++ tzdata
COPY package*.json ./
RUN npm install --omit=dev
COPY server/ ./server/
# 拷贝已构建的前端静态文件
COPY --from=web /web/dist ./web/dist

ENV PORT=8080
ENV DATA_DIR=/app/data
# 统一容器时区为当地时区（新加坡）；compose 可用 TZ 覆盖
ENV TZ=Asia/Singapore
VOLUME /app/data
EXPOSE 8080
CMD ["node", "server/index.js"]
