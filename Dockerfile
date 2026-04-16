# ============================================================
# OpportunityScanner Docker Image
# 基于 node:22-alpine，体积小、启动快、极其稳定
# ============================================================

FROM node:22-alpine

# 设置工作目录
WORKDIR /app

# 预先复制 package 文件以利用 Docker 缓存层
COPY package*.json ./

# 安装生产依赖（不含 devDependencies）
RUN npm ci --production

# 复制源代码
COPY src/ ./src/

# 设置生产环境
ENV NODE_ENV=production

# 创建日志目录
RUN mkdir -p /app/logs

# 运行入口文件
CMD ["npx", "tsx", "src/OpportunityHunter.ts"]
