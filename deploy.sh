#!/bin/bash
# ============================================================
# OpportunityScanner 一键部署脚本
# 用于服务器/VPS 快速部署
# ============================================================

set -e

echo "=========================================="
echo "🚀 OpportunityScanner 部署脚本"
echo "=========================================="

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ 错误: Docker 未安装"
    echo "请先安装 Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# 检查 docker-compose 是否安装
if ! command -v docker compose &> /dev/null; then
    echo "❌ 错误: docker-compose 未安装"
    echo "请先安装 docker-compose"
    exit 1
fi

# 检查环境变量文件
if [ ! -f .env ]; then
    echo "⚠️ 警告: .env 文件不存在"
    echo "创建 .env.example 模板..."
    cat > .env.example << 'EOF'
# API Keys 配置
SERPER_API_KEY=your_serper_api_key_here
DOUBAO_API_KEY=your_doubao_api_key_here
DEEPSEEK_API_KEY=your_deepseek_api_key_here
GITHUB_TOKEN=your_github_token_here

# 邮件服务配置 (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=your_email@gmail.com
SMTP_TO=recipient@example.com
EOF
    echo "请复制 .env.example 为 .env 并填入你的 API Keys"
    exit 1
fi

# 创建日志目录
mkdir -p logs

echo ""
echo "📦 正在构建 Docker 镜像..."
docker compose build --no-cache

echo ""
echo "🚀 正在启动容器..."
docker compose up -d

echo ""
echo "=========================================="
echo "✅ 部署完成！"
echo "=========================================="
echo ""
echo "查看日志: docker compose logs -f"
echo "停止服务: docker compose down"
echo "重启服务: docker compose restart"
echo ""
echo "日志目录: ./logs/"
echo ""
echo "=========================================="
