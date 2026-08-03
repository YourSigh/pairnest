# PairNest 后端部署

[English](deployment.md)

PairNest 默认通过 Docker Compose 启动 MySQL、数据库迁移任务和 API。以下流程适合
单机自托管；公网环境还需要域名和 HTTPS 反向代理。

## 1. 准备环境

- Docker Engine
- Docker Compose v2（用 `docker compose version` 检查）
- 建议至少 1 GB 可用内存
- 公网部署所需的域名、HTTPS 证书和反向代理

克隆仓库后进入项目根目录：

```bash
cp .env.example .env
```

## 2. 配置环境变量

`.env` 中必须填写四个互不相同的值：

```dotenv
PAIRNEST_DB_PASSWORD=
PAIRNEST_DB_ROOT_PASSWORD=
PAIRNEST_APP_SHARED_SECRET=
PAIRNEST_AUTH_TOKEN_SECRET=
```

可以分别执行四次：

```bash
openssl rand -hex 32
```

常用配置：

| 变量 | 用途 |
| --- | --- |
| `PAIRNEST_DB_NAME`、`PAIRNEST_DB_USER` | MySQL 数据库名和用户 |
| `PAIRNEST_DB_PASSWORD` | API 使用的 MySQL 用户密码 |
| `PAIRNEST_DB_ROOT_PASSWORD` | MySQL root 密码 |
| `PAIRNEST_APP_SHARED_SECRET` | 新设备激活时使用的共享密钥 |
| `PAIRNEST_AUTH_TOKEN_SECRET` | 登录令牌签名密钥 |
| `PAIRNEST_API_BIND` | 宿主机监听地址，默认 `127.0.0.1` |
| `PAIRNEST_API_PORT` | 宿主机 API 端口，默认 `4000` |
| `PAIRNEST_CORS_ORIGIN` | Web 客户端允许的来源，可用逗号分隔 |
| `PAIRNEST_TRUST_PROXY` | 正确配置反向代理后设为 `true` |
| `PAIRNEST_TIMEZONE` | 容器时区，例如 `Asia/Shanghai` |

AI 和语音转写配置都是可选的。对应 URL、Key 或模型名为空时，该功能不会启用。
不要把 `.env` 提交到 Git。

## 3. 启动

先检查 Compose 最终配置：

```bash
docker compose config
```

启动服务：

```bash
docker compose up -d
docker compose ps
```

首次启动顺序如下：

1. MySQL 启动并通过健康检查。
2. `migrate` 容器执行 `prisma migrate deploy`。
3. 数据库迁移成功后 API 启动。

`migrate` 显示 `Exited (0)` 代表正常完成，不是故障。检查 API：

```bash
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:4000/v1/ping
```

查看日志：

```bash
docker compose logs -f db migrate api
```

## 4. 配置公网 HTTPS

默认 `PAIRNEST_API_BIND=127.0.0.1`，适合让同一台服务器上的 Caddy、Nginx 或
Traefik 反向代理到 `http://127.0.0.1:4000`。

以 Nginx 为例：

```nginx
server {
    listen 443 ssl http2;
    server_name pairnest.example.com;

    client_max_body_size 64m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

同时在 `.env` 中设置：

```dotenv
PAIRNEST_TRUST_PROXY=true
PAIRNEST_CORS_ORIGIN=https://你的前端域名
```

聊天实时连接使用 `/ws`，反向代理必须转发 WebSocket 的 `Upgrade` 和
`Connection` 请求头。不要在公网使用明文 HTTP。

## 5. 连接 App

App 首次启动时填写后端根地址，例如：

```text
https://pairnest.example.com
```

不要填写 `/v1`，末尾有无 `/` 均可。App 会请求 `/v1/ping` 验证服务。

局域网开发时可以把 `PAIRNEST_API_BIND` 改为 `0.0.0.0`，然后填写
`http://局域网IP:4000`。只应在可信局域网中这样做，并确认防火墙没有把端口暴露到
公网。

## 6. 数据、备份与恢复

Compose 创建两个 named volume：

- `pairnest_db-data`：MySQL 数据
- `pairnest_uploads`：聊天和时间线等上传文件

`docker compose down` 不会删除 volume；`docker compose down -v` 会删除全部业务
数据，使用前务必确认。

备份时应同时保存数据库和上传目录。数据库示例：

```bash
docker compose exec -T db sh -c \
  'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  > pairnest.sql
```

上传文件可以用临时容器从 volume 导出。恢复前停止 API，并确保数据库备份与上传文件
来自同一个时间点。

## 7. 可选语音转写

启用语音转写会把原始音频发送给配置的第三方服务。启用前请阅读[隐私说明](privacy.md)。
PairNest 支持传统 OpenAI 兼容的 `audio/transcriptions` 接口，以及 Qwen3-ASR-Flash
兼容的 `chat/completions` 接口：

```dotenv
# 传统 multipart 上传
PAIRNEST_TRANSCRIPTION_API_MODE=audio-transcriptions
PAIRNEST_TRANSCRIPTION_API_URL=https://provider.example/v1/audio/transcriptions
PAIRNEST_TRANSCRIPTION_API_KEY=replace-me
PAIRNEST_TRANSCRIPTION_MODEL=whisper-1

# 或 Qwen 兼容模式
PAIRNEST_TRANSCRIPTION_API_MODE=qwen-chat-completions
PAIRNEST_TRANSCRIPTION_API_URL=https://workspace.example/compatible-mode/v1
PAIRNEST_TRANSCRIPTION_API_KEY=replace-me
PAIRNEST_TRANSCRIPTION_MODEL=qwen3-asr-flash
```

Qwen 模式的 URL 可以填写 API base，也可以填写完整的 `/chat/completions` 地址。真实
供应商域名、Workspace ID 和密钥只能放在未提交的 `.env` 中。

## 8. 更新

更新代码前先备份。随后在项目根目录执行：

```bash
git pull
docker compose build api migrate
docker compose up -d
docker compose ps
```

`migrate` 会在新 API 启动前执行仓库中已提交的 Prisma migration。生产环境不要用
`prisma db push` 替代 migration。

## 9. 常见问题

迁移失败：

```bash
docker compose logs migrate
docker compose ps db
```

检查数据库密码是否为空、是否包含不适合直接放进连接字符串的字符，以及
`.env` 中数据库配置是否一致。

API 不健康：

```bash
docker compose logs api
docker compose exec api node -e \
  "fetch('http://127.0.0.1:4000/health').then(async r=>console.log(r.status,await r.text()))"
```

手机无法连接时依次检查域名解析、HTTPS 证书、服务器防火墙、反向代理日志、
`/v1/ping` 和 `/ws` 转发。
