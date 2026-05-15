#!/bin/bash
# ============================================================
# OpportunityScanner - 服务器自动化部署脚本
# 功能：拉取最新代码 + 初始化环境 + 设置定时任务
# ============================================================

set -e

echo "=========================================="
echo "🚀 OpportunityScanner 服务器部署"
echo "=========================================="

# 项目目录
PROJECT_DIR="/opt/opportunity-scanner"

# 1. 创建/进入项目目录
if [ ! -d "$PROJECT_DIR" ]; then
    echo "📁 创建项目目录..."
    sudo mkdir -p $PROJECT_DIR
    sudo chown $USER:$USER $PROJECT_DIR
fi

cd $PROJECT_DIR

# 2. 拉取最新代码
echo ""
echo "📥 拉取最新代码..."
if [ -d ".git" ]; then
    git pull origin main
else
    echo "⚠️ 非 Git 仓库，初始化..."
    git init
    git remote add origin https://github.com/JustinXai/OpportunityScanner.git
    git pull origin main
fi

# 3. 安装依赖
echo ""
echo "📦 安装依赖..."
cd opportunity-radar
npm install
cd ..

# 4. 检查环境变量
if [ ! -f .env ]; then
    echo ""
    echo "⚠️ .env 文件不存在，创建模板..."
    cat > .env << 'EOF'
# API Keys - 请替换为你的实际密钥
SERPER_API_KEY=YOUR_SERPER_API_KEY
DEEPSEEK_API_KEY=YOUR_DEEPSEEK_API_KEY
GITHUB_TOKEN=YOUR_GITHUB_TOKEN

# 邮件 SMTP (QQ邮箱) - 请替换为你的实际信息
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=YOUR_EMAIL@qq.com
SMTP_PASS=YOUR_SMTP_PASS
SMTP_FROM=YOUR_EMAIL@qq.com
EMAIL_TO=YOUR_EMAIL@qq.com

NODE_ENV=production
EOF
    echo "请编辑 .env 文件填入你的 API Keys"
fi

# 5. 设置定时任务
echo ""
echo "⏰ 设置定时任务（每两天凌晨5点北京时间）..."

# 北京时间凌晨5点 = UTC 21:00（夏令时）或 22:00
# 每两天 = 48小时
# 使用 crontab 设置

CRON_JOB="0 21 */2 * * cd $PROJECT_DIR && /usr/bin/npm run radar >> logs/cron.log 2>&1"

# 移除旧的 crontab（如果有）
crontab -l 2>/dev/null | grep -v "opportunity-scanner" | crontab - 2>/dev/null || true

# 添加新的 crontab
echo "$CRON_JOB" | crontab -

echo ""
echo "✅ 定时任务已设置:"
crontab -l | grep opportunity

# 6. 创建日志目录
mkdir -p logs

echo ""
echo "=========================================="
echo "✅ 部署完成！"
echo "=========================================="
echo ""
echo "📋 常用命令:"
echo "  手动运行扫描: npm run radar"
echo "  查看日志: tail -f logs/cron.log"
echo "  查看定时任务: crontab -l"
echo "  拉取更新: git pull"
echo ""
echo "⏰ 定时任务: 每两天凌晨5点（北京时间）自动运行"
echo "=========================================="
