# PairNest（双栖）

**一个只属于两个人的私密、自托管空间。**

[English](README.md)

PairNest 包含一个 Expo React Native 客户端，以及一个基于 Express、Prisma 和
MySQL 的自托管服务端。同一套 API 可以服务多对情侣；每对情侣拥有一个相互隔离、且
只包含“伴侣 A”和“伴侣 B”两个成员位置的空间。

每条业务数据都按 `coupleId` 归属空间。API 只从已认证的 JWT 和服务端 Session
确认情侣空间与成员身份，不允许请求 Body、角色 Header 或 WebSocket 消息自行指定
身份。

## 功能

- 支持文字、图片、语音、视频、表情和已读状态的私密聊天
- 时间线、愿望、纪念日和情侣打卡
- 生理期记录与关系报告
- 双人游戏、扭蛋和共享虚拟宠物
- 可选的 AI 对话和语音转写
- App 主题色、时间线场景、聊天背景和底部导航自定义

## 快速启动后端

准备 Docker Engine 和 Docker Compose v2，然后在用于自托管 PairNest 的机器上
执行：

```bash
cp .env.example .env
```

编辑 `.env`，至少填写以下三个互不相同的随机值：

```dotenv
PAIRNEST_DB_PASSWORD=
PAIRNEST_DB_ROOT_PASSWORD=
PAIRNEST_AUTH_TOKEN_SECRET=
```

可以分别执行 `openssl rand -hex 32` 生成。随后启动并检查本机 Compose 服务：

```bash
docker compose config --quiet
docker compose up -d
docker compose ps
curl http://127.0.0.1:4000/health
```

Compose 会在本地构建 API，启动 MySQL，执行 `prisma migrate deploy`，并使用 named
volume 持久化数据库和上传文件。它不会发布镜像、配置域名或自动提供 HTTPS。把 API
开放到公网前，需要自行配置 HTTPS 反向代理。

完整配置、数据持久化、限制、备份、更新和故障排查说明见
[后端部署文档](docs/deployment.zh-CN.md)。

## 配对、恢复与删除

创建情侣空间时，服务端会返回一枚包含 26 个有效字符（分组显示）的邀请密钥，以及
另一枚独立的恢复密钥。邀请密钥 24 小时后过期，在受邀位置加入后失效；每次创建新
邀请也会替换旧邀请。恢复密钥长期有效，应单独妥善保存；轮换恢复密钥会立即使旧值
失效。

服务端会把设备绑定到伴侣 A 或伴侣 B，并把确认后的身份写入 Session 和 JWT。退出
登录会撤销服务端 Session，并断开对应 WebSocket。恢复流程可以替换丢失或已退出的
设备，同时撤销该成员位置原有的 Session。

尚未配对的空间可以立即删除。已经配对的空间需要另一位伴侣确认；如果无法取得对方
确认，申请人可在七天后再次确认删除。删除会移除该空间的数据库记录和已登记媒体文件，
但无法清除独立备份或已发送给第三方服务的数据。

## 运行和打包 App

本地开发需要 Node.js 20 和 npm；Android 原生构建还需要 Java 17、Android Studio
和 Android SDK。

```bash
npm ci
npm run typecheck
npm run lint
npm run android
```

App 使用运行时 PairNest API 地址。正式构建只接受 HTTPS 实例；明文 HTTP 仅用于
本机或可信局域网开发。运营者可以通过 `EXPO_PUBLIC_PAIRNEST_DEFAULT_API_URL`
提供公开默认地址，但该值会写入安装包，绝对不能包含密钥。

Android APK、商店 AAB、iOS 包、EAS 云构建和本地构建流程见
[App 打包文档](docs/app-build.zh-CN.md)。

## 服务端开发

```bash
cd server
npm ci
npm run build
npm run dev
```

本地开发需要自行提供 `PAIRNEST_DATABASE_URL`，以及至少 32 字符的
`PAIRNEST_AUTH_TOKEN_SECRET`。使用 Docker Compose 通常更省事。

## 隐私与安全

PairNest 会保存关系、健康、聊天和媒体等敏感数据。每对情侣默认拥有 2 GiB 上传
额度，单个视频默认不超过 100 MiB。IP 和情侣空间维度的限流可以减少匿名滥用和意外
消耗，但不能替代 HTTPS、备份、监控和安全的宿主机配置。

把实例暴露到公网或升级旧数据库前，请阅读[隐私说明](docs/privacy.zh-CN.md)和
[迁移说明](docs/migration.zh-CN.md)。安全问题请按照 [SECURITY.md](SECURITY.md)
私下报告。

暂缓实现的功能见 [ROADMAP.md](ROADMAP.md)。

## 许可证

Copyright (C) 2026 yoursigh。

PairNest 采用
[GNU Affero General Public License v3.0 only](LICENSE)（`AGPL-3.0-only`）。
修改 PairNest 并通过网络向用户提供服务时，需要遵守该许可证关于提供对应源代码的
要求。
