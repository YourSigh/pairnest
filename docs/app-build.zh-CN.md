# PairNest App 运行与打包

[English](app-build.md)

PairNest 使用 Expo SDK 54 和 EAS Build。仓库的 `eas.json` 已包含
`development`、`preview` 和 `production` 三个 profile。

## 1. 准备环境

所有平台都需要：

- Node.js 20
- npm
- Git

Android 本地构建还需要 Java 17、Android Studio 和 Android SDK。iOS 本地构建必须
使用 macOS，并安装 Xcode 和 CocoaPods。iPhone 真机或 App Store 构建需要 Apple
Developer 账号。

安装依赖并检查代码：

```bash
npm ci
npm run typecheck
npm run lint
npx expo-doctor
```

## 2. 本地开发

Android：

```bash
npm run android
```

iOS（仅 macOS）：

```bash
npm run ios
```

仓库使用 dev client。原生 App 安装好后，可用以下命令只启动 Metro：

```bash
npm run dev
```

如果修改了 `app.json` 的原生插件、权限或原生模块，需要重新运行原生构建，不能只重启
Metro。

## 3. 配置 EAS

安装并登录 EAS CLI：

```bash
npm install --global eas-cli
eas login
eas whoami
```

首次在自己的 Expo 账号下构建 fork 时执行：

```bash
eas init
eas build:configure
```

确认 `app.json` 中的以下标识属于你自己且保持稳定：

- `expo.slug`
- `expo.ios.bundleIdentifier`
- `expo.android.package`

发布过 App 后不要随意更改 bundle identifier 或 package name，否则系统会把它视为
另一个 App。

后端地址默认不写入安装包，用户首次启动时自行填写。仅开发专用构建可以设置
`EXPO_PUBLIC_PAIRNEST_DEFAULT_API_URL`；`EXPO_PUBLIC_*` 会被打进客户端，绝对不能
放密钥。

## 4. Android APK

当前 `production` profile 在 `eas.json` 中配置了
`android.buildType: "apk"`，可以直接生成可安装 APK：

```bash
npm run build:android
```

预览构建也可以使用：

```bash
npm run build:preview
```

构建完成后从 EAS 构建页面下载 APK，通过下载链接安装，或执行：

```bash
adb install /path/to/pairnest.apk
```

Android 可能要求用户允许“安装未知应用”。向其他人分发前应妥善保管签名凭据，并先在
真实设备上测试登录、通知、后台消息、相机、语音和应用内更新。

## 5. Google Play AAB

Google Play 通常使用 AAB。复制或新增一个不含
`android.buildType: "apk"` 的 EAS profile，例如：

```json
{
  "build": {
    "store": {
      "autoIncrement": true,
      "android": {
        "credentialsSource": "remote"
      }
    }
  }
}
```

然后执行：

```bash
eas build --platform android --profile store
```

首次构建时 EAS 会询问是否生成并托管 Android keystore。已有正式 keystore 时应选择
对应的凭据流程，避免生成无法覆盖旧版本的新签名。

## 6. iOS 构建

云端构建：

```bash
eas build --platform ios --profile production
```

首次执行时根据提示登录 Apple Developer 账号并配置证书、Provisioning Profile 和
设备。`production` 构建通常用于 TestFlight/App Store，不能像 Android APK 一样随意
安装到任意设备。

如需内部真机测试，可给 iOS 单独增加 `distribution: "internal"` 的 profile，并注册
测试设备：

```bash
eas device:create
eas build --platform ios --profile preview
```

## 7. 本地 release 构建

使用 Expo CLI 验证本机原生工程：

```bash
npx expo run:android --variant release
npx expo run:ios --configuration Release
```

也可以在已准备好完整 Android/iOS 工具链的机器上运行 EAS 本地构建：

```bash
eas build --platform android --profile production --local
eas build --platform ios --profile production --local
```

本地 EAS 构建仍需要登录 Expo，且需要自行准备平台工具链和环境变量。

## 8. 发布前检查

每次发布前至少执行：

```bash
npm ci
npm run typecheck
npm run lint
```

同时检查：

- `app.json` 中版本号、Android `versionCode` 和 iOS build number
- 图标、启动页、权限说明和应用名称
- 生产 HTTPS 后端可访问，`/health`、`/v1/ping` 和 `/ws` 正常
- 安装包中没有 API Key、签名文件或其他密钥
- 全新安装、升级安装和更换服务器流程均可用

Expo 官方参考：

- <https://docs.expo.dev/build/setup/>
- <https://docs.expo.dev/build-reference/apk/>
- <https://docs.expo.dev/build-reference/local-builds/>
