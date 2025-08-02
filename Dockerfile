FROM node:18-alpine

# 安装必要的系统工具
RUN apk add --no-cache \
    curl \
    wget \
    ca-certificates \
    procps

# 创建应用目录
WORKDIR /app

# 复制package.json文件
COPY package.json ./

# 安装npm依赖（虽然当前为空，但保持结构完整）
RUN npm install --production

# 复制应用代码
COPY index.js ./

# 创建非root用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S vpnuser -u 1001 -G nodejs

# 设置文件权限
RUN chown -R vpnuser:nodejs /app
USER vpnuser

# 暴露端口
EXPOSE 8080

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# 启动命令
CMD ["npm", "start"]
