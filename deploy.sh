#!/usr/bin/env bash
# HomeFlow 一键升级：备份数据库 → 拉取最新代码 → 重建并重启（用户数据保留，绝不删 data/）
# 用法：在服务器上进入 ~/homeflow 后执行  ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE="docker compose -f docker-compose.prod.yml"
BACKUP_DIR="$HOME/homeflow-backups"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "==> 1/4 备份当前数据 → $BACKUP_DIR/data-$STAMP.tar.gz"
mkdir -p "$BACKUP_DIR"
if [ -d data ]; then
  sudo tar czf "$BACKUP_DIR/data-$STAMP.tar.gz" -C . data
  echo "    ✓ 备份完成"
  # 仅保留最近 10 份备份
  ls -1t "$BACKUP_DIR"/data-*.tar.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
else
  echo "    (无 data 目录，跳过备份)"
fi

echo "==> 2/4 拉取最新代码"
git pull --ff-only

echo "==> 3/4 重建并重启（保留 data/，不动数据库）"
$COMPOSE up -d --build

echo "==> 4/4 容器状态"
$COMPOSE ps

echo
echo "✅ 升级完成：https://helpermanagement.xyz"
echo "   如需回滚：$COMPOSE down && sudo tar xzf $BACKUP_DIR/data-$STAMP.tar.gz -C . && $COMPOSE up -d"
