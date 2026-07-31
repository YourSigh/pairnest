# PairNest（双栖）

**一个只属于两个人的私密、自托管空间。**

[English](README.md)

PairNest 是一个 Expo React Native 客户端，以及可自行部署的
Express/Prisma/MySQL 服务端。v0.1 在尽量保留现有成熟功能的同时，移除原私人项目的
个人数据、私人部署配置和服务器地址。

PairNest v0.1 明确采用“一套实例只服务一对情侣”的设计，不支持多租户或多个空间。

## 功能

- 支持图片、语音、视频和表情的私密聊天
- 时间线、愿望、纪念日和情侣打卡
- 生理期记录
- 报告、游戏、扭蛋和共享虚拟宠物
- 可选的 AI 对话、语音转写和 OpenClaw 集成

所有第三方集成只有在部署者主动配置后才会启用。正式移动端构建不会内置默认
PairNest 服务器地址。

## 快速开始

需要：

- Docker Engine 与 Docker Compose v2
- 公网部署时自行准备 HTTPS 反向代理

```bash
cp .env.example .env
```

打开 `.env`，填写四个必需的密码或密钥，然后启动：

```bash
docker compose up -d
docker compose ps
curl http://127.0.0.1:4000/health
```

Compose 栈包含 MySQL、一次性 Prisma migration 服务和 API。数据库与上传文件保存
在 Docker named volumes 中。

配置、联网、升级和故障排查请阅读[部署文档](docs/deployment.md)。

## 移动端开发

需要：

- Node.js 20
- npm
- Android 原生构建还需要 Java 17 和 Android SDK

```bash
npm ci
npm run lint
npx tsc --noEmit
npm run android
```

请在 App 的运行时服务器配置中填写 PairNest 实例地址。除可信开发局域网外，应当使用
HTTPS。

## 服务端开发

```bash
cd server
npm ci
npm run build
npm run dev
```

本地服务端还需要 `PAIRNEST_DATABASE_URL` 及[部署文档](docs/deployment.md)中列出的认证环境变量。

## 隐私与安全

PairNest 会保存高度敏感的关系、健康、聊天和媒体数据。在把实例暴露到互联网或启用
第三方 AI、语音转写服务前，请阅读[隐私说明](docs/privacy.md)。

安全问题请按照 [SECURITY.md](SECURITY.md) 中的方式私下报告。

## 项目状态

PairNest v0.1 的重点是与原私人 App 安全隔离、支持自托管并保留现有行为。更大的产品
和基础设施改造记录在 [Roadmap](ROADMAP.md)。

迁移范围与验证记录见
[OPEN_SOURCE_MIGRATION_REPORT.md](OPEN_SOURCE_MIGRATION_REPORT.md)。

## 许可证

Copyright (C) 2026 yoursigh。

PairNest 采用
[GNU Affero General Public License v3.0 only](LICENSE)（`AGPL-3.0-only`）。
任何修改 PairNest 并通过网络向用户提供服务的部署者，都需要遵守该许可证关于提供
对应源代码的要求。
