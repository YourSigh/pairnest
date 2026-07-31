import Ionicons from "@expo/vector-icons/Ionicons";
import {
  CameraView,
  type CameraType,
  useCameraPermissions,
  useMicrophonePermissions,
} from "expo-camera";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  ChatPhotoCropEditor,
  type ChatPhotoAsset,
} from "@/components/chat-photo-crop-editor";
import { ThemedText } from "@/components/themed-text";
import { AppColors, createThemedStyleSheet } from "@/constants/theme";

const LONG_PRESS_DELAY_MS = 320;
const MIN_VIDEO_DURATION_MS = 500;

export type ChatCameraCapture =
  | {
      type: "photo";
      uri: string;
      width: number;
      height: number;
      mimeType: "image/jpeg";
    }
  | {
      type: "video";
      uri: string;
      width: number;
      height: number;
      durationMs: number;
      fileSize: number | null;
      mimeType: "video/mp4" | "video/quicktime";
    };

type ChatCameraModalProps = {
  visible: boolean;
  disabled?: boolean;
  maxVideoDurationMs: number;
  maxVideoSize: number;
  onClose: () => void;
  onCapture: (capture: ChatCameraCapture) => void;
  onError: (message: string) => void;
};

function formatRecordingDuration(durationMs: number) {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function ChatCameraModal({
  visible,
  disabled = false,
  maxVideoDurationMs,
  maxVideoSize,
  onClose,
  onCapture,
  onError,
}: ChatCameraModalProps) {
  const cameraRef = useRef<CameraView>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingStartedAtRef = useRef(0);
  const wantsVideoRef = useRef(false);
  const recordingRef = useRef(false);
  const startingRecordingRef = useRef(false);
  const releasedRef = useRef(false);
  const discardRecordingRef = useRef(false);
  const closeAfterRecordingRef = useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] =
    useMicrophonePermissions();
  const [facing, setFacing] = useState<CameraType>("back");
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraMode, setCameraMode] = useState<"picture" | "video">("picture");
  const [capturingPhoto, setCapturingPhoto] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<ChatPhotoAsset | null>(null);
  const [croppingPhoto, setCroppingPhoto] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);

  const clearHoldTimer = () => {
    if (!holdTimerRef.current) return;
    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  };

  const resetRecordingState = () => {
    wantsVideoRef.current = false;
    recordingRef.current = false;
    startingRecordingRef.current = false;
    releasedRef.current = false;
    setRecording(false);
    setRecordingDurationMs(0);
    setCameraMode("picture");
  };

  useEffect(() => {
    if (!visible) return;
    discardRecordingRef.current = false;
    closeAfterRecordingRef.current = false;
    setCameraReady(false);
    setFacing("back");
    setFlashEnabled(false);
    setPhotoPreview(null);
    setCroppingPhoto(false);
    resetRecordingState();
    if (!cameraPermission?.granted) {
      void requestCameraPermission();
    }
    if (!microphonePermission?.granted) {
      void requestMicrophonePermission();
    }
    return () => {
      clearHoldTimer();
    };
    // Permission requests should run once each time the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => {
      setRecordingDurationMs(Date.now() - recordingStartedAtRef.current);
    }, 100);
    return () => clearInterval(interval);
  }, [recording]);

  const finishRecording = async (result: { uri: string } | undefined) => {
    const durationMs = Math.min(
      maxVideoDurationMs,
      Math.max(0, Date.now() - recordingStartedAtRef.current),
    );
    const discarded = discardRecordingRef.current;
    const shouldClose = closeAfterRecordingRef.current;
    resetRecordingState();
    if (!result?.uri) {
      if (!discarded) onError("视频录制失败，请重试");
      if (shouldClose) onClose();
      return;
    }
    if (discarded || durationMs < MIN_VIDEO_DURATION_MS) {
      await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(
        () => undefined,
      );
      if (!discarded) onError("录像时间太短，请长按一会儿再松开");
      if (shouldClose) onClose();
      return;
    }

    const info = await FileSystem.getInfoAsync(result.uri);
    onCapture({
      type: "video",
      uri: result.uri,
      width: 0,
      height: 0,
      durationMs,
      fileSize: info.exists && typeof info.size === "number" ? info.size : null,
      mimeType: result.uri.split("?")[0]?.toLowerCase().endsWith(".mov")
        ? "video/quicktime"
        : "video/mp4",
    });
  };

  const startRecording = async () => {
    if (
      !visible ||
      !wantsVideoRef.current ||
      recordingRef.current ||
      startingRecordingRef.current
    ) {
      return;
    }
    if (!microphonePermission?.granted) {
      wantsVideoRef.current = false;
      setCameraMode("picture");
      onError("需要麦克风权限才能录制有声音的视频");
      return;
    }
    const camera = cameraRef.current;
    if (!camera) return;

    startingRecordingRef.current = true;
    recordingRef.current = true;
    recordingStartedAtRef.current = Date.now();
    setRecordingDurationMs(0);
    setRecording(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const recordingPromise = camera.recordAsync({
        maxDuration: Math.max(1, Math.floor(maxVideoDurationMs / 1000)),
        maxFileSize: maxVideoSize,
        ...(Platform.OS === "ios" ? { codec: "avc1" as const } : {}),
      });
      startingRecordingRef.current = false;
      if (releasedRef.current) {
        camera.stopRecording();
      }
      const result = await recordingPromise;
      await finishRecording(result);
    } catch (error) {
      const discarded = discardRecordingRef.current;
      const shouldClose = closeAfterRecordingRef.current;
      resetRecordingState();
      if (!discarded) {
        onError(error instanceof Error ? error.message : "视频录制失败，请重试");
      }
      if (shouldClose) onClose();
    }
  };

  useEffect(() => {
    if (cameraMode !== "video" || !wantsVideoRef.current || !visible) return;
    const timer = setTimeout(() => {
      void startRecording();
    }, 180);
    return () => clearTimeout(timer);
    // startRecording intentionally reads the latest refs after the camera mode commits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraMode, visible]);

  const takePhoto = async () => {
    if (
      !cameraReady ||
      capturingPhoto ||
      recordingRef.current ||
      disabled
    ) {
      return;
    }
    try {
      setCapturingPhoto(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const photo = await cameraRef.current?.takePictureAsync({
        quality: 0.9,
        skipProcessing: false,
      });
      if (!photo?.uri) throw new Error("拍照失败，请重试");
      setPhotoPreview({
        uri: photo.uri,
        width: photo.width,
        height: photo.height,
        mimeType: "image/jpeg",
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : "拍照失败，请重试");
    } finally {
      setCapturingPhoto(false);
    }
  };

  const handleShutterPressIn = () => {
    if (!cameraReady || capturingPhoto || recordingRef.current || disabled) {
      return;
    }
    releasedRef.current = false;
    clearHoldTimer();
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      wantsVideoRef.current = true;
      setCameraMode("video");
    }, LONG_PRESS_DELAY_MS);
  };

  const handleShutterPressOut = () => {
    if (holdTimerRef.current) {
      clearHoldTimer();
      void takePhoto();
      return;
    }
    if (!wantsVideoRef.current && !recordingRef.current) return;
    releasedRef.current = true;
    if (recordingRef.current) {
      cameraRef.current?.stopRecording();
    }
  };

  const handleClose = () => {
    clearHoldTimer();
    if (photoPreview) {
      void FileSystem.deleteAsync(photoPreview.uri, {
        idempotent: true,
      }).catch(() => undefined);
      setPhotoPreview(null);
      setCroppingPhoto(false);
      onClose();
      return;
    }
    discardRecordingRef.current = true;
    closeAfterRecordingRef.current = true;
    if (recordingRef.current) {
      cameraRef.current?.stopRecording();
      return;
    }
    onClose();
  };

  const handleRetakePhoto = () => {
    if (!photoPreview) return;
    void FileSystem.deleteAsync(photoPreview.uri, {
      idempotent: true,
    }).catch(() => undefined);
    setPhotoPreview(null);
    setCroppingPhoto(false);
    setCameraReady(false);
  };

  const handleCroppedPhoto = (photo: ChatPhotoAsset) => {
    if (photoPreview && photoPreview.uri !== photo.uri) {
      void FileSystem.deleteAsync(photoPreview.uri, {
        idempotent: true,
      }).catch(() => undefined);
    }
    setPhotoPreview(photo);
    setCroppingPhoto(false);
  };

  const handleSendPhoto = () => {
    if (!photoPreview || disabled) return;
    const capture = photoPreview;
    setPhotoPreview(null);
    setCroppingPhoto(false);
    onCapture({
      type: "photo",
      ...capture,
    });
  };

  const cameraDenied = cameraPermission && !cameraPermission.granted;
  const requestingPermission = cameraPermission === null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        {photoPreview ? (
          croppingPhoto ? (
            <ChatPhotoCropEditor
              photo={photoPreview}
              onCancel={() => setCroppingPhoto(false)}
              onComplete={handleCroppedPhoto}
              onError={onError}
            />
          ) : (
            <View style={styles.photoPreviewContainer}>
              <Image
                source={{ uri: photoPreview.uri }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
              />
              <SafeAreaView
                pointerEvents="box-none"
                style={styles.photoPreviewControls}
              >
                <View style={styles.photoPreviewHeader}>
                  <Pressable
                    style={styles.roundButton}
                    onPress={handleClose}
                    accessibilityLabel="关闭照片预览"
                  >
                    <Ionicons
                      name="close"
                      size={27}
                      color={AppColors.white}
                    />
                  </Pressable>
                  <ThemedText style={styles.photoPreviewTitle}>
                    确认照片
                  </ThemedText>
                  <View style={styles.photoPreviewHeaderSpacer} />
                </View>
                <View style={styles.photoPreviewFooter}>
                  <Pressable
                    style={styles.photoPreviewSecondaryButton}
                    onPress={handleRetakePhoto}
                    disabled={disabled}
                  >
                    <Ionicons
                      name="camera-reverse-outline"
                      size={22}
                      color={AppColors.white}
                    />
                    <ThemedText style={styles.photoPreviewSecondaryText}>
                      重拍
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    style={styles.photoPreviewSecondaryButton}
                    onPress={() => setCroppingPhoto(true)}
                    disabled={disabled}
                  >
                    <Ionicons
                      name="crop-outline"
                      size={22}
                      color={AppColors.white}
                    />
                    <ThemedText style={styles.photoPreviewSecondaryText}>
                      裁切
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.photoPreviewSendButton,
                      disabled && styles.disabled,
                    ]}
                    onPress={handleSendPhoto}
                    disabled={disabled}
                  >
                    <ThemedText style={styles.photoPreviewSendText}>
                      发送
                    </ThemedText>
                    <Ionicons name="send" size={19} color="#111" />
                  </Pressable>
                </View>
              </SafeAreaView>
            </View>
          )
        ) : cameraPermission?.granted ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            active={visible}
            facing={facing}
            mode={cameraMode}
            flash={cameraMode === "picture" && flashEnabled ? "on" : "off"}
            enableTorch={cameraMode === "video" && flashEnabled}
            videoQuality="720p"
            videoBitrate={2_000_000}
            responsiveOrientationWhenOrientationLocked
            onCameraReady={() => setCameraReady(true)}
            onMountError={(event) => onError(event.message)}
          />
        ) : null}

        {!photoPreview && requestingPermission ? (
          <View style={styles.permissionState}>
            <Pressable
              style={styles.permissionClose}
              onPress={handleClose}
              accessibilityLabel="关闭相机"
            >
              <Ionicons name="close" size={27} color={AppColors.white} />
            </Pressable>
            <ActivityIndicator color={AppColors.white} />
            <ThemedText style={styles.permissionText}>
              正在请求相机权限…
            </ThemedText>
          </View>
        ) : null}

        {!photoPreview && cameraDenied ? (
          <View style={styles.permissionState}>
            <Pressable
              style={styles.permissionClose}
              onPress={handleClose}
              accessibilityLabel="关闭相机"
            >
              <Ionicons name="close" size={27} color={AppColors.white} />
            </Pressable>
            <Ionicons name="camera-outline" size={42} color={AppColors.white} />
            <ThemedText style={styles.permissionTitle}>无法使用相机</ThemedText>
            <ThemedText style={styles.permissionText}>
              请在系统设置中允许相机权限后再拍摄
            </ThemedText>
            <Pressable
              style={styles.settingsButton}
              onPress={() => void Linking.openSettings()}
            >
              <ThemedText style={styles.settingsButtonText}>前往设置</ThemedText>
            </Pressable>
          </View>
        ) : null}

        {!photoPreview ? (
        <SafeAreaView pointerEvents="box-none" style={styles.controls}>
          <View style={styles.topBar}>
            <Pressable
              style={styles.roundButton}
              onPress={handleClose}
              disabled={capturingPhoto}
              accessibilityLabel="关闭相机"
            >
              <Ionicons name="close" size={27} color={AppColors.white} />
            </Pressable>
            <View style={styles.topActions}>
              <Pressable
                style={styles.roundButton}
                onPress={() => setFlashEnabled((enabled) => !enabled)}
                disabled={!cameraPermission?.granted || recording}
                accessibilityLabel={flashEnabled ? "关闭闪光灯" : "打开闪光灯"}
              >
                <Ionicons
                  name={flashEnabled ? "flash" : "flash-off"}
                  size={22}
                  color={flashEnabled ? "#FFD76A" : AppColors.white}
                />
              </Pressable>
              <Pressable
                style={styles.roundButton}
                onPress={() =>
                  setFacing((current) =>
                    current === "back" ? "front" : "back",
                  )
                }
                disabled={!cameraPermission?.granted || recording}
                accessibilityLabel="切换摄像头"
              >
                <Ionicons
                  name="camera-reverse-outline"
                  size={25}
                  color={AppColors.white}
                />
              </Pressable>
            </View>
          </View>

          <View style={styles.bottomBar}>
            {recording ? (
              <View style={styles.recordingBadge}>
                <View style={styles.recordingDot} />
                <ThemedText style={styles.recordingTime}>
                  {formatRecordingDuration(recordingDurationMs)}
                </ThemedText>
              </View>
            ) : (
              <ThemedText style={styles.hint}>
                轻触拍照 · 长按录像
              </ThemedText>
            )}
            <Pressable
              style={[
                styles.shutterOuter,
                recording && styles.shutterOuterRecording,
                (!cameraReady || disabled) && styles.disabled,
              ]}
              onPressIn={handleShutterPressIn}
              onPressOut={handleShutterPressOut}
              disabled={
                !cameraPermission?.granted ||
                !cameraReady ||
                capturingPhoto ||
                disabled
              }
              accessibilityLabel="轻触拍照，长按录像"
            >
              {capturingPhoto ? (
                <ActivityIndicator color="#111" />
              ) : (
                <View
                  style={[
                    styles.shutterInner,
                    recording && styles.shutterInnerRecording,
                  ]}
                />
              )}
            </Pressable>
            <View style={styles.bottomSpacer} />
          </View>
        </SafeAreaView>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = createThemedStyleSheet({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  controls: {
    flex: 1,
    justifyContent: "space-between",
  },
  photoPreviewContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  photoPreviewControls: {
    flex: 1,
    justifyContent: "space-between",
  },
  photoPreviewHeader: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  photoPreviewTitle: {
    color: AppColors.white,
    fontSize: 16,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.62)",
    textShadowRadius: 4,
  },
  photoPreviewHeaderSpacer: {
    width: 44,
  },
  photoPreviewFooter: {
    minHeight: 112,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: "rgba(0,0,0,0.58)",
  },
  photoPreviewSecondaryButton: {
    minWidth: 68,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 13,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  photoPreviewSecondaryText: {
    color: AppColors.white,
    fontSize: 14,
    fontWeight: "700",
  },
  photoPreviewSendButton: {
    flex: 1,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 24,
    backgroundColor: AppColors.white,
  },
  photoPreviewSendText: {
    color: "#111",
    fontSize: 15,
    fontWeight: "800",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  topActions: {
    flexDirection: "row",
    gap: 12,
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  bottomBar: {
    minHeight: 174,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 22,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  hint: {
    marginBottom: 16,
    color: AppColors.white,
    fontSize: 14,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.65)",
    textShadowRadius: 4,
  },
  recordingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.46)",
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FF4D55",
  },
  recordingTime: {
    minWidth: 42,
    color: AppColors.white,
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
  },
  shutterOuter: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 5,
    borderColor: AppColors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterOuterRecording: {
    borderColor: "#FFDFE1",
  },
  shutterInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: AppColors.white,
  },
  shutterInnerRecording: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: "#FF4D55",
  },
  bottomSpacer: {
    height: 0,
  },
  disabled: {
    opacity: 0.45,
  },
  permissionState: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 36,
    backgroundColor: "#121212",
  },
  permissionClose: {
    position: "absolute",
    top: 54,
    left: 18,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  permissionTitle: {
    color: AppColors.white,
    fontSize: 19,
    fontWeight: "800",
  },
  permissionText: {
    color: "rgba(255,255,255,0.74)",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  settingsButton: {
    marginTop: 6,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 22,
    backgroundColor: AppColors.white,
  },
  settingsButtonText: {
    color: "#111",
    fontSize: 14,
    fontWeight: "800",
  },
});
