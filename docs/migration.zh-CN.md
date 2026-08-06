# PairNest v0.1 迁移说明

[English](migration.md)

本文覆盖 PairNest v0.1 全新安装，以及从旧版单情侣数据库结构升级的流程。升级前必须
同时备份 MySQL 和上传 volume。MySQL 的结构变更不具备完整事务性；迁移失败后，不要
在生产库上直接反复重试，应先检查数据库状态，必要时恢复到已验证的备份。

## v0.1 的主要变化

- 新增 `Couple`，作为每个独立情侣空间的所有者；
- 每条业务数据和设备 Session 都必须包含 `coupleId`；
- 租户相关唯一约束和索引都包含 `coupleId`；
- 租户记录通过带级联删除的数据库外键关联 `Couple`；
- 不再相信客户端自行声明的身份，改为服务端绑定伴侣 A / 伴侣 B，并写入 JWT；
- 增加 24 小时邀请、长期可轮换恢复密钥、持久限流桶、情侣空间存储额度和数据删除；
- 移除服务端全局 AI 外部上下文目录配置。

部分业务表内部仍保留旧的 `female` / `male` 值，以避免与开源无关的大规模数据改写。
认证层只暴露中性的伴侣 A / 伴侣 B，也不接受这些旧值作为身份声明。

## 全新安装

Compose 的 `migrate` 服务会通过 `prisma migrate deploy` 执行仓库中已提交的两次
migration。全新数据库不会创建占位情侣空间；首个空间由用户在 App 中创建。具体步骤见
[部署文档](deployment.zh-CN.md)。

## 升级旧数据库

1. 停止旧 API，确保备份和迁移期间没有新写入；
2. 把 MySQL 数据库和上传 volume 作为同一组数据备份；
3. 切换到 v0.1 代码，并参照 `.env.example` 更新 `.env`；旧备份应离线保存，不要把
   任何密钥复制到公开仓库；
4. 执行 `docker compose build api migrate` 和 `docker compose up -d`；
5. 确认 `migrate` 以状态 0 退出、API 健康，且旧记录只出现在迁移后的情侣空间；
6. 在删除旧部署前，验证两个成员身份、REST、WebSocket、媒体下载、退出和恢复流程。

迁移会把旧单情侣结构中的所有记录归入保留的 `legacy-default-couple`。迁移完成前会移除
用于回填的临时数据库默认值，因此后续业务写入必须携带已认证的租户上下文。

## 旧 shared secret 兼容方式

升级后的数据库可能仍在 `AuthConfig` 中保存旧共享激活密钥的哈希。v0.1 的
`POST /v1/auth/activate` 可以使用原密钥，为 `legacy-default-couple` 激活伴侣 A 或
伴侣 B。请求需要提供：

```json
{
  "sharedSecret": "旧单情侣版本的原始密钥",
  "deviceId": "稳定且唯一的设备标识",
  "deviceSecret": "至少 32 个随机字符",
  "partnerRole": "partnerA",
  "device": {
    "deviceName": "可选的迁移设备名称",
    "platform": "可选的平台名称"
  }
}
```

第二位成员使用 `partnerB`。只有数据库仍含旧 `AuthConfig`、运营者保留原始密钥，且
显式设置 `PAIRNEST_ALLOW_LEGACY_SHARED_SECRET_ACTIVATE=true` 时，此兼容路径才可用。
它受 IP/设备失败次数限制保护，服务端会校验已有 scrypt 哈希。迁移完成后请保持该开关
为 `false`，即使 `AuthConfig` 仍在。

公开 PairNest App 不会内置、公开或要求这个旧密钥。只应通过可信的一次性迁移客户端或
运营者控制的请求使用它，然后建立正常的恢复密钥流程。不要把旧密钥写入
`.env.example`、源码、截图、Shell 历史或 Issue。

## 验证

升级后按部署环境执行：

```bash
docker compose ps
docker compose logs migrate
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:4000/v1/ping
```

开发仓库还应执行：

```bash
npm ci
npm run typecheck
npm run lint
cd server
npm ci
npm run build
```

至少创建两个不同情侣空间，并确认它们只能访问各自数据和媒体后，才能认为升级完成。

## 回滚

当前没有自动降级 migration。升级失败时，应停止新服务，并同时恢复升级前的数据库与
对应上传备份。只恢复其中一项，可能导致媒体文件缺失或数据库仍引用旧文件。
