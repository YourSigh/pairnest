# PairNest（双栖）

**一个只属于两个人的私密、自托管空间。**

[English](README.md)

PairNest 包含一个 Expo React Native 客户端，以及一个基于
Express、Prisma 和 MySQL 的自托管服务端。一套实例只服务一对伴侣，不支持多租户或
多个独立空间。

## 功能

- 支持文字、图片、语音、视频、表情和已读状态的私密聊天
- 时间线、愿望、纪念日和情侣打卡
- 生理期记录与关系报告
- 双人游戏、扭蛋和共享虚拟宠物
- 可选的 AI 对话和语音转写
- App 主题色、时间线场景、聊天背景和底部导航自定义

## 快速启动后端

准备 Docker Engine 和 Docker Compose v2，然后执行：

```bash
cp .env.example .env
```

编辑 `.env`，至少填写以下四项：

```dotenv
PAIRNEST_DB_PASSWORD=
PAIRNEST_DB_ROOT_PASSWORD=
PAIRNEST_APP_SHARED_SECRET=
PAIRNEST_AUTH_TOKEN_SECRET=
```

可以用 `openssl rand -hex 32` 分别生成独立的值。随后启动并检查服务：

```bash
docker compose config
docker compose up -d
docker compose ps
curl http://127.0.0.1:4000/health
```

公网部署必须在 API 前配置 HTTPS 反向代理。完整的端口、反向代理、持久化、备份、
更新和故障排查说明见[后端部署文档](docs/deployment.zh-CN.md)。

## 运行和打包 App

本地开发需要 Node.js 20 和 npm；Android 原生构建还需要 Java 17、Android Studio
和 Android SDK。

```bash
npm ci
npm run typecheck
npm run lint
npm run android
```

App 首次启动时会要求填写 PairNest 后端地址。公网环境请填写 HTTPS 地址。

Android APK、商店 AAB、iOS 包、EAS 云构建和本地构建的完整流程见
[App 打包文档](docs/app-build.zh-CN.md)。

## 服务端开发

```bash
cd server
npm ci
npm run build
npm run dev
```

本地开发需要自行提供 `PAIRNEST_DATABASE_URL`、`PAIRNEST_APP_SHARED_SECRET` 和
`PAIRNEST_AUTH_TOKEN_SECRET`。使用 Docker Compose 通常更省事。

## 隐私与安全

PairNest 会保存关系、健康、聊天和媒体等敏感数据。把实例暴露到公网或启用第三方
AI、语音转写服务前，请阅读[隐私说明](docs/privacy.md)。

安全问题请按照 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

Copyright (C) 2026 yoursigh。

PairNest 采用
[GNU Affero General Public License v3.0 only](LICENSE)（`AGPL-3.0-only`）。
修改 PairNest 并通过网络向用户提供服务时，需要遵守该许可证关于提供对应源代码的
要求。
