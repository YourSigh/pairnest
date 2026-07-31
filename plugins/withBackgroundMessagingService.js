const { withAndroidManifest } = require("expo/config-plugins");

const SERVICE_NAME =
  "com.asterinet.react.bgactions.RNBackgroundActionsTask";

module.exports = function withBackgroundMessagingService(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    const manifest = configWithManifest.modResults.manifest;
    const application = manifest.application?.[0];
    if (!application) {
      throw new Error("AndroidManifest is missing the main application");
    }

    application.service = application.service || [];
    let service = application.service.find(
      (entry) => entry.$?.["android:name"] === SERVICE_NAME,
    );
    if (!service) {
      service = { $: { "android:name": SERVICE_NAME } };
      application.service.push(service);
    }

    service.$["android:exported"] = "false";
    service.$["android:stopWithTask"] = "false";
    service.$["android:foregroundServiceType"] = "remoteMessaging";
    return configWithManifest;
  });
};
