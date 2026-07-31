import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { AppColors, createThemedStyleSheet } from "@/constants/theme";

type CropRatio = "free" | "1:1" | "4:3" | "16:9";

type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Size = {
  width: number;
  height: number;
};

export type ChatPhotoAsset = {
  uri: string;
  width: number;
  height: number;
  mimeType: "image/jpeg";
};

type ChatPhotoCropEditorProps = {
  photo: ChatPhotoAsset;
  onCancel: () => void;
  onComplete: (photo: ChatPhotoAsset) => void;
  onError: (message: string) => void;
};

const MIN_CROP_SIZE = 72;
const CROP_INSET = 18;

const RATIO_OPTIONS: { value: CropRatio; label: string; ratio: number | null }[] =
  [
    { value: "free", label: "自由", ratio: null },
    { value: "1:1", label: "1:1", ratio: 1 },
    { value: "4:3", label: "4:3", ratio: 4 / 3 },
    { value: "16:9", label: "16:9", ratio: 16 / 9 },
  ];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getContainedImageSize(viewport: Size, photo: ChatPhotoAsset): Size {
  if (
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    photo.width <= 0 ||
    photo.height <= 0
  ) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(
    viewport.width / photo.width,
    viewport.height / photo.height,
  );
  return {
    width: photo.width * scale,
    height: photo.height * scale,
  };
}

function createCenteredCrop(imageSize: Size, ratio: number | null): CropRect {
  const maxWidth = Math.max(1, imageSize.width - CROP_INSET * 2);
  const maxHeight = Math.max(1, imageSize.height - CROP_INSET * 2);
  let width = maxWidth;
  let height = maxHeight;

  if (ratio) {
    if (width / height > ratio) {
      width = height * ratio;
    } else {
      height = width / ratio;
    }
  }

  return {
    x: (imageSize.width - width) / 2,
    y: (imageSize.height - height) / 2,
    width,
    height,
  };
}

export function ChatPhotoCropEditor({
  photo,
  onCancel,
  onComplete,
  onError,
}: ChatPhotoCropEditorProps) {
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [cropRatio, setCropRatio] = useState<CropRatio>("free");
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [processing, setProcessing] = useState(false);
  const gestureStartRef = useRef<CropRect | null>(null);
  const imageSize = useMemo(
    () => getContainedImageSize(viewport, photo),
    [photo, viewport],
  );
  const imageOffset = useMemo(
    () => ({
      x: (viewport.width - imageSize.width) / 2,
      y: (viewport.height - imageSize.height) / 2,
    }),
    [imageSize, viewport],
  );

  useEffect(() => {
    if (imageSize.width <= 0 || imageSize.height <= 0) return;
    const option = RATIO_OPTIONS.find((item) => item.value === cropRatio);
    setCropRect(createCenteredCrop(imageSize, option?.ratio ?? null));
  }, [cropRatio, imageSize]);

  const moveResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !processing,
        onMoveShouldSetPanResponder: (_, gesture) =>
          !processing &&
          (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
        onPanResponderGrant: () => {
          gestureStartRef.current = cropRect;
        },
        onPanResponderMove: (_, gesture) => {
          const start = gestureStartRef.current;
          if (!start) return;
          setCropRect({
            ...start,
            x: clamp(
              start.x + gesture.dx,
              0,
              imageSize.width - start.width,
            ),
            y: clamp(
              start.y + gesture.dy,
              0,
              imageSize.height - start.height,
            ),
          });
        },
      }),
    [cropRect, imageSize, processing],
  );

  const resizeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !processing,
        onMoveShouldSetPanResponder: () => !processing,
        onPanResponderGrant: () => {
          gestureStartRef.current = cropRect;
        },
        onPanResponderMove: (_, gesture) => {
          const start = gestureStartRef.current;
          if (!start) return;
          const maxWidth = imageSize.width - start.x;
          const maxHeight = imageSize.height - start.y;
          const ratioOption = RATIO_OPTIONS.find(
            (item) => item.value === cropRatio,
          );
          const ratio = ratioOption?.ratio ?? null;

          if (!ratio) {
            setCropRect({
              ...start,
              width: clamp(
                start.width + gesture.dx,
                Math.min(MIN_CROP_SIZE, maxWidth),
                maxWidth,
              ),
              height: clamp(
                start.height + gesture.dy,
                Math.min(MIN_CROP_SIZE, maxHeight),
                maxHeight,
              ),
            });
            return;
          }

          const widthFromX = start.width + gesture.dx;
          const widthFromY = (start.height + gesture.dy) * ratio;
          const requestedWidth =
            Math.abs(gesture.dx) >= Math.abs(gesture.dy)
              ? widthFromX
              : widthFromY;
          const minWidth = Math.min(MIN_CROP_SIZE, maxWidth, maxHeight * ratio);
          const width = clamp(
            requestedWidth,
            minWidth,
            Math.min(maxWidth, maxHeight * ratio),
          );
          setCropRect({
            ...start,
            width,
            height: width / ratio,
          });
        },
      }),
    [cropRatio, cropRect, imageSize, processing],
  );

  const handleViewportLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport({ width, height });
  };

  const handleComplete = async () => {
    if (!cropRect || imageSize.width <= 0 || imageSize.height <= 0) return;
    try {
      setProcessing(true);
      const scaleX = photo.width / imageSize.width;
      const scaleY = photo.height / imageSize.height;
      const originX = clamp(
        Math.round(cropRect.x * scaleX),
        0,
        Math.max(0, photo.width - 1),
      );
      const originY = clamp(
        Math.round(cropRect.y * scaleY),
        0,
        Math.max(0, photo.height - 1),
      );
      const width = clamp(
        Math.round(cropRect.width * scaleX),
        1,
        photo.width - originX,
      );
      const height = clamp(
        Math.round(cropRect.height * scaleY),
        1,
        photo.height - originY,
      );
      const result = await manipulateAsync(
        photo.uri,
        [{ crop: { originX, originY, width, height } }],
        {
          compress: 0.9,
          format: SaveFormat.JPEG,
        },
      );
      onComplete({
        uri: result.uri,
        width: result.width,
        height: result.height,
        mimeType: "image/jpeg",
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : "照片裁切失败，请重试");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable
          style={styles.headerButton}
          onPress={onCancel}
          disabled={processing}
        >
          <ThemedText style={styles.headerButtonText}>取消</ThemedText>
        </Pressable>
        <ThemedText style={styles.title}>裁切照片</ThemedText>
        <Pressable
          style={styles.headerButton}
          onPress={() =>
            setCropRect(
              createCenteredCrop(
                imageSize,
                RATIO_OPTIONS.find((item) => item.value === cropRatio)?.ratio ??
                  null,
              ),
            )
          }
          disabled={processing}
        >
          <ThemedText style={styles.headerButtonText}>重置</ThemedText>
        </Pressable>
      </View>

      <View style={styles.canvas} onLayout={handleViewportLayout}>
        {imageSize.width > 0 && imageSize.height > 0 && cropRect ? (
          <>
            <Image
              source={{ uri: photo.uri }}
              style={[
                styles.image,
                {
                  left: imageOffset.x,
                  top: imageOffset.y,
                  width: imageSize.width,
                  height: imageSize.height,
                },
              ]}
              contentFit="fill"
            />
            <View
              pointerEvents="none"
              style={[
                styles.mask,
                {
                  left: imageOffset.x,
                  top: imageOffset.y,
                  width: imageSize.width,
                  height: cropRect.y,
                },
              ]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.mask,
                {
                  left: imageOffset.x,
                  top: imageOffset.y + cropRect.y + cropRect.height,
                  width: imageSize.width,
                  height:
                    imageSize.height - cropRect.y - cropRect.height,
                },
              ]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.mask,
                {
                  left: imageOffset.x,
                  top: imageOffset.y + cropRect.y,
                  width: cropRect.x,
                  height: cropRect.height,
                },
              ]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.mask,
                {
                  left: imageOffset.x + cropRect.x + cropRect.width,
                  top: imageOffset.y + cropRect.y,
                  width:
                    imageSize.width - cropRect.x - cropRect.width,
                  height: cropRect.height,
                },
              ]}
            />
            <View
              style={[
                styles.cropBox,
                {
                  left: imageOffset.x + cropRect.x,
                  top: imageOffset.y + cropRect.y,
                  width: cropRect.width,
                  height: cropRect.height,
                },
              ]}
              {...moveResponder.panHandlers}
            >
              <View pointerEvents="none" style={styles.gridVerticalOne} />
              <View pointerEvents="none" style={styles.gridVerticalTwo} />
              <View pointerEvents="none" style={styles.gridHorizontalOne} />
              <View pointerEvents="none" style={styles.gridHorizontalTwo} />
              <View
                style={styles.resizeHandleTouch}
                {...resizeResponder.panHandlers}
              >
                <View style={styles.resizeHandle} />
              </View>
            </View>
          </>
        ) : (
          <ActivityIndicator color={AppColors.white} />
        )}
      </View>

      <View style={styles.footer}>
        <View style={styles.ratioRow}>
          {RATIO_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              style={[
                styles.ratioButton,
                cropRatio === option.value && styles.ratioButtonActive,
              ]}
              onPress={() => setCropRatio(option.value)}
              disabled={processing}
            >
              <ThemedText
                style={[
                  styles.ratioText,
                  cropRatio === option.value && styles.ratioTextActive,
                ]}
              >
                {option.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        <Pressable
          style={[styles.completeButton, processing && styles.disabled]}
          onPress={() => void handleComplete()}
          disabled={processing}
        >
          {processing ? (
            <ActivityIndicator size="small" color="#111" />
          ) : (
            <>
              <Ionicons name="checkmark" size={20} color="#111" />
              <ThemedText style={styles.completeButtonText}>完成裁切</ThemedText>
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = createThemedStyleSheet({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    height: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
  },
  title: {
    color: AppColors.white,
    fontSize: 16,
    fontWeight: "800",
  },
  headerButton: {
    minWidth: 48,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerButtonText: {
    color: AppColors.white,
    fontSize: 14,
    fontWeight: "700",
  },
  canvas: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  image: {
    position: "absolute",
  },
  mask: {
    position: "absolute",
    backgroundColor: "rgba(0,0,0,0.58)",
  },
  cropBox: {
    position: "absolute",
    borderWidth: 1.5,
    borderColor: AppColors.white,
  },
  gridVerticalOne: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "33.333%",
    width: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.62)",
  },
  gridVerticalTwo: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "66.666%",
    width: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.62)",
  },
  gridHorizontalOne: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "33.333%",
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.62)",
  },
  gridHorizontalTwo: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "66.666%",
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.62)",
  },
  resizeHandleTouch: {
    position: "absolute",
    right: -20,
    bottom: -20,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  resizeHandle: {
    width: 18,
    height: 18,
    borderRightWidth: 4,
    borderBottomWidth: 4,
    borderColor: AppColors.white,
  },
  footer: {
    gap: 18,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: "#080808",
  },
  ratioRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
  },
  ratioButton: {
    minWidth: 58,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 17,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  ratioButtonActive: {
    backgroundColor: AppColors.white,
  },
  ratioText: {
    color: "rgba(255,255,255,0.76)",
    fontSize: 13,
    fontWeight: "700",
  },
  ratioTextActive: {
    color: "#111",
  },
  completeButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 24,
    backgroundColor: AppColors.white,
  },
  completeButtonText: {
    color: "#111",
    fontSize: 15,
    fontWeight: "800",
  },
  disabled: {
    opacity: 0.55,
  },
});
