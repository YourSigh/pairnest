# PairNest 后端部署

[English](deployment.md)

本文介绍如何自托管一套可以容纳多对独立情侣空间的 PairNest API。仓库内的 Compose
包含 MySQL、一次性 Prisma 迁移任务和 API。以下命令只作用于实际执行命令那台机器的
Docker Engine，不会配置远程服务器、镜像仓库、域名、反向代理或自动 HTTPS。

## 1. 准备环境

- Docker Engine
- Docker Compose v2（用 `docker compose version` 检查）
- 小型实例建议至少 1 GB 可用内存
- API 暴露到公网前自行准备 HTTPS 终止

## 2. 创建本机配置

在仓库根目录执行：

```bash
cp .env.example .env
```

填写所有必填空值，并分别生成三个独立随机值：

```bash
openssl rand -hex 24
openssl rand -hex 24
openssl rand -hex 32
```

前两个 URL 安全的十六进制值分别用于 `PAIRNEST_DB_PASSWORD` 和
`PAIRNEST_DB_ROOT_PASSWORD`；最后一个用于 `PAIRNEST_AUTH_TOKEN_SECRET`，且
长度不得少于 32 字符。

不要把 `.env` 提交到 Git，也不要在不同部署之间复用数据库密码、JWT 密钥、签名密钥
或业务数据。

常用配置：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PAIRNEST_DB_NAME` / `PAIRNEST_DB_USER` | `pairnest` | MySQL 数据库和业务用户 |
| `PAIRNEST_DB_PASSWORD` / `PAIRNEST_DB_ROOT_PASSWORD` | 必填 | 两个相互独立的 MySQL 密码 |
| `PAIRNEST_AUTH_TOKEN_SECRET` | 必填 | 签发访问令牌，并用于认证失败记录的伪名化 |
| `PAIRNEST_ALLOW_OPEN_COUPLE_CREATE` | `true` | 是否允许匿名创建情侣空间；公网实例可设为 `false` |
| `PAIRNEST_API_BIND` / `PAIRNEST_API_PORT` | `127.0.0.1` / `4000` | 宿主机监听地址和端口 |
| `PAIRNEST_CORS_ORIGIN` | `*` | 浏览器来源，多个值用英文逗号分隔 |
| `PAIRNEST_TRUST_PROXY` | `false` | 是否信任代理提供的客户端地址和协议 |
| `PAIRNEST_TIMEZONE` | `UTC` | MySQL 和 API 容器时区 |
| `PAIRNEST_REQUEST_TIMEOUT_MS` | `300000` | HTTP 请求超时，限制在 30 秒到 30 分钟之间 |
| `PAIRNEST_STORAGE_QUOTA_BYTES` | `2147483648` | 每对情侣已登记上传文件额度（2 GiB） |
| `PAIRNEST_MAX_VIDEO_UPLOAD_BYTES` | `104857600` | 单个视频上限（100 MiB） |
| `PAIRNEST_AI_REQUEST_TIMEOUT_MS` | `120000` | AI 上游请求超时 |
| `PAIRNEST_TRANSCRIPTION_REQUEST_TIMEOUT_MS` | `120000` | 语音转写上游请求超时 |

只有当访问 API 的所有路径都经过可信反向代理，且代理会覆盖转发 Header 时，才能启用
`PAIRNEST_TRUST_PROXY`。PairNest 会使用解析出的客户端 IP 对匿名接口限流。

AI 和语音转写配置都是可选的；对应 URL、Key 或模型为空时，集成保持关闭。PairNest
不支持服务端全局 AI 外部上下文目录。

## 3. 检查并启动

先检查 Compose 最终配置：

```bash
docker compose config --quiet
```

启动本机服务：

```bash
docker compose up -d
docker compose ps
```

启动顺序如下：

1. MySQL 启动并通过健康检查；
2. `migrate` 对这套 MySQL 执行 `prisma migrate deploy`；
3. 迁移成功后 API 启动并通过 `/health`。

`migrate` 显示 `Exited (0)` 代表正常完成。检查 API：

```bash
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:4000/v1/ping
```

启动失败时查看日志：

```bash
docker compose logs -f db migrate api
```

## 4. 通过 HTTPS 对外提供服务

局域网开发时，可以设置 `PAIRNEST_API_BIND=0.0.0.0`，并在 App 中使用宿主机可信
局域网地址，例如 `http://192.168.x.x:4000`。

明文 HTTP 会把认证材料和关系数据暴露给网络观察者，禁止用于公网。公网部署应保持 API
绑定 `127.0.0.1`，在前面配置自己的 HTTPS 反向代理，并为 `/ws` 转发 WebSocket。
反向代理允许的请求体应略大于视频上限；默认 100 MiB 视频上限可使用 128 MiB，以
容纳 multipart 开销。

以下是 Nginx location 示例（省略证书与 DNS 配置）：

```nginx
client_max_body_size 128m;

location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

随后设置 `PAIRNEST_TRUST_PROXY=true`；如果使用浏览器客户端，还应限制
`PAIRNEST_CORS_ORIGIN`。仓库不会附带 Caddy 或任何自动 TLS 配置。

## 5. 创建和恢复情侣空间

用户首次进入时可以创建空间或输入邀请。创建空间会得到两个不同的秘密值：

- 一枚包含 26 个有效字符、分组显示的邀请密钥；24 小时后过期，目标成员加入后失效；
- 一枚同等熵的长期恢复密钥；在认证成员主动轮换前持续有效。

服务端只保存哈希。请把恢复密钥保存在密码管理器或同等级的安全位置。生成新邀请会使
旧邀请失效；轮换恢复密钥会使旧恢复密钥失效。
维护任务每六小时清除一次过期邀请哈希。创建后从未激活任何设备 Session 的开放空间会
被视为已放弃，并在七天后删除。

服务端会把每台设备绑定到伴侣 A 或伴侣 B，并在有效 Session 的 JWT 中写入确认后的
成员与情侣空间身份。退出登录会撤销 Session；恢复激活会替换并断开该位置原有的
Session。

## 6. 租户隔离、限制与删除

所有业务表都按 `coupleId` 限定，并通过带级联删除的外键关联所属情侣空间。API 和
WebSocket 操作只从已认证 Session 获取情侣空间和身份。

主要固定窗口默认限制如下：

| 维度 | 操作 | 默认值 |
| --- | --- | --- |
| IP | 创建情侣空间 | 每小时 5 次 |
| IP | 校验邀请或激活设备 | 每 15 分钟 30 次 |
| IP + 设备 | 激活连续失败 | 15 分钟内 5 次后锁定 60 分钟 |
| 情侣空间 | 媒体上传 | 每小时 120 次 |
| 情侣空间 | AI 请求 | 每小时 60 次且每天 300 次 |
| 情侣空间 | 语音转写 | 每小时 20 次且每天 100 次 |
| 情侣空间 | 邀请 / 轮换恢复密钥 | 每小时 10 次 / 5 次 |

其他生成与删除接口也有情侣空间级限流。限流只能降低滥用风险，不能替代宿主机监控或
第三方供应商的消费上限。

尚未配对的空间收到请求后立即删除；已经配对的空间需要另一位成员确认，或者由原申请人
等待七天后再次确认。删除会移除数据库记录和已登记媒体，并断开该空间的活动 WebSocket。
独立备份和第三方供应商数据需要另行处理，详见[隐私说明](privacy.zh-CN.md)。

## 7. 数据持久化与备份

Compose 创建两个 named volume：

- `pairnest_db-data`：MySQL 数据；
- `pairnest_uploads`：聊天、时间线和表情等媒体。

实际前缀取决于 Compose 项目名。`docker compose down` 只删除容器和网络，会保留两个
volume。

除非确实要销毁全部 PairNest 数据，否则不要执行 `docker compose down -v`。数据库
与上传文件必须作为同一组数据一起备份和恢复。PairNest v0.1 不提供自动或加密备份。

## 8. 更新与迁移

更新前先备份两个 volume。源码部署可执行：

```bash
docker compose build api migrate
docker compose up -d
docker compose ps
```

一次性迁移任务会在新 API 启动前应用仓库中已提交的 Prisma migration。生产环境不要
用 `prisma db push` 代替 `prisma migrate deploy`。升级旧的单情侣数据库前，请先阅读
[迁移说明](migration.zh-CN.md)。

## 9. 可选 AI 与语音转写

启用任一集成都会把数据发送给配置的第三方。供应商 URL、Workspace 标识和 Key 只能
放在 `.env` 中，并应同时检查供应商的隐私和消费限制。

AI 使用 OpenAI 兼容的 chat-completions 地址。语音支持 OpenAI 兼容的
`audio/transcriptions` 和 Qwen 兼容的 `chat/completions`：

```dotenv
PAIRNEST_AI_API_URL=https://provider.example/v1
PAIRNEST_AI_API_KEY=replace-me
PAIRNEST_AI_MODEL=replace-me
PAIRNEST_AI_REQUEST_TIMEOUT_MS=120000

PAIRNEST_TRANSCRIPTION_API_MODE=audio-transcriptions
PAIRNEST_TRANSCRIPTION_API_URL=https://provider.example/v1/audio/transcriptions
PAIRNEST_TRANSCRIPTION_API_KEY=replace-me
PAIRNEST_TRANSCRIPTION_MODEL=whisper-1
PAIRNEST_TRANSCRIPTION_LANGUAGE=zh
PAIRNEST_TRANSCRIPTION_REQUEST_TIMEOUT_MS=120000
```

使用 `qwen-chat-completions` 时，转写 URL 可以是 API base，也可以是完整的
`/chat/completions` 地址。120 秒本地超时不代表供应商会停止处理已经收到的请求。

## 10. 常见问题

迁移失败：

```bash
docker compose logs migrate
docker compose ps db
```

确认数据库配置非空、适合直接写入 URL 且彼此一致。

API 不健康：

```bash
docker compose logs api
docker compose exec api node -e \
  "fetch('http://127.0.0.1:4000/health').then(async r=>console.log(r.status,await r.text()))"
```

手机无法连接时：

- 确认 App 使用正确的运行时 PairNest 实例地址；
- 确认 `PAIRNEST_API_BIND` 允许预期的网络接口；
- 检查 DNS、宿主机防火墙、反向代理、`/v1/ping` 和 `/ws`；
- 本机或可信开发局域网以外必须使用 HTTPS。
