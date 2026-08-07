# PairNest 公网生产部署

[English](production-deployment.md)

本文面向一台全新的 Linux 云服务器，最终得到可供 App 使用的 HTTPS/WSS PairNest
实例。服务器只需要 Docker Engine、Docker Compose、Nginx 和证书工具，不需要安装
Node.js、Java、Android SDK 或 Prisma。

## 1. 选择服务端镜像来源

PairNest 支持三种方式：

- 源码构建：克隆仓库后运行根目录 `compose.yaml`，适合开发；
- 镜像部署：在本地或 CI 构建 API 镜像并推送到镜像仓库，服务器使用
  `deploy/compose.registry.yaml` 拉取镜像；
- 外部数据库：已有 MySQL 时使用 `deploy/compose.external-db.yaml`，只启动迁移和 API。

国内云服务器通常适合镜像部署。每套 PairNest 应使用独立镜像仓库名，例如
`pairnest-api`，不要覆盖另一个应用的镜像标签。在本地登录镜像仓库后构建并推送：

```bash
PAIRNEST_API_IMAGE=registry.example.com/namespace/pairnest-api:0.1.0 \
  make publish-api
```

镜像不包含 `.env`、数据库密码、JWT 密钥或 AI Key。生产环境推荐版本号或 Git commit
等不可变标签，不要只依赖 `latest`。

## 2. 准备云服务器

云厂商安全组只需开放：

- TCP 22：SSH，建议限制为管理员 IP；
- TCP 80：HTTP 跳转和证书签发；
- TCP 443：App 的 HTTPS 和 WSS。

不要向公网开放 MySQL 3306、API 4000 或 Docker daemon 端口。Docker 发布端口可能绕过
部分宿主机防火墙规则，因此生产 Compose 默认只把 API 绑定到 `127.0.0.1`。

按照 Docker 官方文档安装 Docker Engine、Buildx 和 Compose plugin，并确认：

```bash
docker version
docker compose version
```

服务器使用镜像部署时不需要 Node.js。安装并启动宿主机 Nginx；证书可使用 Certbot 的
Nginx 集成签发。

## 3. 配置域名、环境和部署目录

给 API 域名添加 A/AAAA 记录，例如：

```text
pairnest.example.com -> 服务器公网 IP
```

在服务器准备：

```text
/opt/pairnest/
├── compose.yaml
└── .env
```

`compose.yaml` 使用仓库的 `deploy/compose.registry.yaml`，`.env` 从
`deploy/.env.registry.example` 复制。生成三个互不相同的值：

```bash
openssl rand -hex 24
openssl rand -hex 24
openssl rand -hex 32
```

分别填写数据库业务用户密码、MySQL root 密码和 `PAIRNEST_AUTH_TOKEN_SECRET`。公共
多情侣实例保持 `PAIRNEST_ALLOW_OPEN_COUPLE_CREATE=true`；私人单情侣实例完成配对后
可改为 `false`。

## 4. 拉取镜像并启动

私有镜像仓库需要在服务器登录一次：

```bash
docker login registry.example.com
```

检查配置并启动：

```bash
cd /opt/pairnest
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
curl http://127.0.0.1:4000/health
```

`migrate` 容器显示 `Exited (0)` 是正常结果，表示 `prisma migrate deploy` 已完成。数据库
保存在 `pairnest_db-data` volume，上传文件保存在 `pairnest_uploads` volume。

## 5. 配置 Nginx 和 HTTPS

复制 `deploy/nginx/pairnest.conf.example` 到 Nginx 站点目录，替换示例域名后检查并重载：

```bash
nginx -t
systemctl reload nginx
```

域名生效且 80 端口可访问后，按照 Certbot 官方说明使用 Nginx 插件申请证书。成功后
验证：

```bash
curl https://pairnest.example.com/health
curl https://pairnest.example.com/v1/ping
```

模板已包含大文件上传、长连接和 WebSocket 转发。启用 HTTPS 后保持
`PAIRNEST_TRUST_PROXY=true`。

## 6. 构建 App

本地构建可以在仓库根目录创建不会提交的 `.env`：

```dotenv
EXPO_PUBLIC_PAIRNEST_DEFAULT_API_URL=https://pairnest.example.com
```

使用 EAS 云构建时，还要按 [App 打包文档](app-build.zh-CN.md)把同一个公开地址设置到
EAS 的 `production` environment；不要假定云端能读取本机 `.env`。

然后按照 [App 打包文档](app-build.zh-CN.md)运行：

```bash
npm ci
npm run typecheck
npm run lint
npm run build:android
```

首次 EAS 构建需要登录 Expo 并创建或选择 Android keystore。以后更新必须继续使用同一
签名凭据。

## 7. 更新服务

推送新的不可变镜像标签，修改服务器 `.env` 中的 `PAIRNEST_API_IMAGE`，备份数据库和
上传 volume 后执行：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

新镜像的 migration 会先运行，成功后 API 才会启动。不要执行
`docker compose down -v`，它会删除持久化数据。

## 8. 复用已有 MySQL

高级部署使用 `deploy/compose.external-db.yaml`。数据库容器和 PairNest API 必须加入
同一个 Docker 网络；连接地址的主机名是数据库容器名，端口是容器内部 3306，不是
宿主机映射端口。

在 MySQL 中创建独立数据库和独立最小权限用户后填写：

```dotenv
PAIRNEST_DOCKER_NETWORK=existing-network
PAIRNEST_DATABASE_URL=mysql://pairnest:独立密码@mysql-container:3306/pairnest
```

然后启动。它不会创建、停止或重启已有 MySQL：

```bash
docker compose -f compose.external-db.yaml config --quiet
docker compose -f compose.external-db.yaml pull
docker compose -f compose.external-db.yaml up -d
```

官方参考：[Docker Engine](https://docs.docker.com/engine/install/ubuntu/)、
[Compose plugin](https://docs.docker.com/compose/install/linux/) 和
[Certbot](https://certbot.eff.org/instructions)。
