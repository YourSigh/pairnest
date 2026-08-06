# Building the PairNest app

[简体中文](app-build.zh-CN.md)

PairNest uses Expo SDK 54 and EAS Build. The checked-in `eas.json` defines
`development`, `preview`, and `production` profiles.

## Prerequisites

- Node.js 20, npm, and Git
- Android local builds: Java 17, Android Studio, and the Android SDK
- iOS local builds: macOS, Xcode, and CocoaPods
- iOS device/App Store builds: an Apple Developer account

Install and verify:

```bash
npm ci
npm run typecheck
npm run lint
npx expo-doctor
```

## Local development

```bash
npm run android
npm run ios
```

After a dev client is installed, start Metro with `npm run dev`. Rebuild the
native app after changing native plugins, permissions, or native dependencies.

## EAS setup

```bash
npm install --global eas-cli
eas login
eas whoami
eas init
eas build:configure
```

Fork maintainers should set their own stable `expo.slug`,
`expo.ios.bundleIdentifier`, and `expo.android.package` values. Do not change
published bundle/package identifiers unless you intend to create a separate
app.

The backend URL is selected at runtime. An operator can provide a public
default with `EXPO_PUBLIC_PAIRNEST_DEFAULT_API_URL`, but every `EXPO_PUBLIC_*`
value is embedded in the client and must never contain a secret. Production
builds require an HTTPS PairNest URL; plain HTTP is accepted only by
development builds for localhost or private-network testing.

The instance URL is not an authentication secret. Users still create a couple
space or join with the 26-character invitation shown by their partner. Never
put an invitation or recovery key in an `EXPO_PUBLIC_*` variable.

## Android APK and Play Store AAB

The current `production` profile explicitly produces an installable APK:

```bash
npm run build:android
```

The preview profile can be built with:

```bash
npm run build:preview
```

Download the resulting APK from EAS or install it with
`adb install /path/to/pairnest.apk`.

Google Play normally expects an AAB. Add an EAS profile without
`android.buildType: "apk"` and build it:

```bash
eas build --platform android --profile store
```

Keep the Android signing key stable across all updates.

## iOS

For a TestFlight/App Store build:

```bash
eas build --platform ios --profile production
```

Follow the prompts to configure Apple certificates and provisioning. For
internal device distribution, add an iOS profile with
`distribution: "internal"`, register devices with `eas device:create`, and
build that profile.

## Local release builds

```bash
npx expo run:android --variant release
npx expo run:ios --configuration Release
```

To execute the EAS workflow on your own prepared build machine:

```bash
eas build --platform android --profile production --local
eas build --platform ios --profile production --local
```

Local EAS builds still require Expo authentication and the complete native
toolchain.

## Release checklist

- Run `npm ci`, `npm run typecheck`, `npm run lint`, and `npx expo-doctor`
- Review app version/build numbers, icons, permissions, and signing credentials
- Verify the production HTTPS backend, `/health`, `/v1/ping`, and `/ws`
- Confirm that no API keys, signing files, or other secrets are embedded
- Test clean installation, upgrade installation, notifications, camera, audio,
  background messaging, and server switching on real devices

Official Expo references:

- <https://docs.expo.dev/build/setup/>
- <https://docs.expo.dev/build-reference/apk/>
- <https://docs.expo.dev/build-reference/local-builds/>
