const fs = require("fs");
const path = require("path");
const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require("expo/config-plugins");

const PACKAGE_CLASS = "PairNestAppUpdatePackage";

function addUniqueByName(items, item) {
  const name = item.$["android:name"];
  if (!items.some((entry) => entry.$?.["android:name"] === name)) {
    items.push(item);
  }
}

module.exports = function withAppUpdateDownload(config) {
  const androidPackage = config.android?.package;
  if (!androidPackage) throw new Error("android.package is required");
  const nativePackage = `${androidPackage}.updates`;

  config = withAndroidManifest(config, (configWithManifest) => {
    const manifest = configWithManifest.modResults.manifest;
    manifest["uses-permission"] = manifest["uses-permission"] || [];
    addUniqueByName(manifest["uses-permission"], {
      $: { "android:name": "android.permission.REQUEST_INSTALL_PACKAGES" },
    });

    const application = manifest.application?.[0];
    if (!application) throw new Error("AndroidManifest is missing the main application");

    application.activity = application.activity || [];
    addUniqueByName(application.activity, {
      $: {
        "android:name": `${nativePackage}.PairNestInstallActivity`,
        "android:exported": "false",
        "android:launchMode": "singleTop",
        "android:theme": "@android:style/Theme.Translucent.NoTitleBar",
      },
    });

    application.receiver = application.receiver || [];
    addUniqueByName(application.receiver, {
      $: {
        "android:name": `${nativePackage}.PairNestDownloadReceiver`,
        "android:exported": "true",
      },
      "intent-filter": [
        {
          action: [{ $: { "android:name": "android.intent.action.DOWNLOAD_COMPLETE" } }],
        },
      ],
    });
    return configWithManifest;
  });

  config = withMainApplication(config, (configWithApplication) => {
    let contents = configWithApplication.modResults.contents;
    const importLine = `import ${nativePackage}.${PACKAGE_CLASS}`;
    if (!contents.includes(importLine)) {
      contents = contents.replace(
        /^(package\s+[^\n]+\n)/m,
        `$1\n${importLine}\n`,
      );
    }
    if (!contents.includes(`add(${PACKAGE_CLASS}())`)) {
      contents = contents.replace(
        "// add(MyReactNativePackage())",
        `// add(MyReactNativePackage())\n              add(${PACKAGE_CLASS}())`,
      );
    }
    configWithApplication.modResults.contents = contents;
    return configWithApplication;
  });

  return withDangerousMod(config, ["android", async (configWithMod) => {
    const targetDir = path.join(
      configWithMod.modRequest.platformProjectRoot,
      "app/src/main/java",
      ...nativePackage.split("."),
    );
    const sourceDir = path.join(__dirname, "app-update-native");
    fs.mkdirSync(targetDir, { recursive: true });
    for (const filename of fs.readdirSync(sourceDir)) {
      if (!filename.endsWith(".kt")) continue;
      const source = fs
        .readFileSync(path.join(sourceDir, filename), "utf8")
        .replaceAll("__NATIVE_PACKAGE__", nativePackage);
      fs.writeFileSync(path.join(targetDir, filename), source);
    }
    return configWithMod;
  }]);
};
