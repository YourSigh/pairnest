import Ionicons from "@expo/vector-icons/Ionicons";
import { Canvas, Path } from "@shopify/react-native-skia";
import * as Haptics from "expo-haptics";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppAlert } from "@/components/app-dialog";
import { AppColors } from "@/constants/theme";
import type {
  DrawGuessPoint,
  DrawGuessStroke,
} from "@/services/DrawGuessService";

const COMMON_COLORS = [
  { name: "墨黑", value: "#2F2F2F" },
  { name: "玫红", value: "#E85F86" },
  { name: "晴蓝", value: "#5E91E8" },
  { name: "草绿", value: "#52A675" },
  { name: "橙色", value: "#F1A33C" },
] as const;

const ALL_COLORS = [
  ...COMMON_COLORS,
  { name: "石板灰", value: "#667085" },
  { name: "咖啡棕", value: "#8B5E3C" },
  { name: "正红", value: "#D94B4B" },
  { name: "珊瑚", value: "#F07C6C" },
  { name: "明黄", value: "#F6D34A" },
  { name: "青柠", value: "#A8C94E" },
  { name: "薄荷", value: "#6EC9A8" },
  { name: "青绿", value: "#3FA7A3" },
  { name: "湖蓝", value: "#56B6D9" },
  { name: "天蓝", value: "#67A7E8" },
  { name: "深蓝", value: "#3F5FA8" },
  { name: "靛青", value: "#6574C4" },
  { name: "葡萄紫", value: "#8C6BC0" },
  { name: "薰衣草", value: "#A874D6" },
  { name: "梅子", value: "#C65AA4" },
  { name: "粉红", value: "#EB87AF" },
  { name: "酒红", value: "#9E465C" },
  { name: "橄榄", value: "#7D8B4C" },
  { name: "金棕", value: "#C9912E" },
] as const;

const COMMON_COLOR_VALUES = new Set<string>(
  COMMON_COLORS.map((item) => item.value),
);
const LIGHT_COLOR_VALUES = new Set(["#F6D34A", "#A8C94E", "#6EC9A8"]);

const WIDTHS = [0.008, 0.015, 0.028] as const;
const MAX_STROKES = 240;
const MAX_POINTS = 8_000;

type DrawGuessCanvasProps = {
  strokes: DrawGuessStroke[];
  editable?: boolean;
  onChange?: (strokes: DrawGuessStroke[]) => void;
  onDrawingActiveChange?: (active: boolean) => void;
};

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function pathForPoints(points: DrawGuessPoint[], width: number, height: number) {
  if (points.length === 0) return "";
  const scaled = points.map((point) => ({
    x: point.x * width,
    y: point.y * height,
  }));
  const first = scaled[0];
  if (scaled.length === 1) {
    return `M ${first.x} ${first.y} L ${first.x + 0.01} ${first.y + 0.01}`;
  }
  if (scaled.length === 2) {
    return `M ${first.x} ${first.y} L ${scaled[1].x} ${scaled[1].y}`;
  }

  let result = `M ${first.x} ${first.y}`;
  for (let index = 1; index < scaled.length - 1; index += 1) {
    const point = scaled[index];
    const next = scaled[index + 1];
    result += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
  }
  const last = scaled[scaled.length - 1];
  result += ` L ${last.x} ${last.y}`;
  return result;
}

function countPoints(strokes: DrawGuessStroke[]) {
  return strokes.reduce((total, stroke) => total + stroke.points.length, 0);
}

export function DrawGuessCanvas({
  strokes,
  editable = false,
  onChange,
  onDrawingActiveChange,
}: DrawGuessCanvasProps) {
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [color, setColor] = useState<string>(COMMON_COLORS[0].value);
  const [strokeWidth, setStrokeWidth] = useState<number>(WIDTHS[1]);
  const [eraser, setEraser] = useState(false);
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const strokesRef = useRef(strokes);
  const editableRef = useRef(editable);
  const onChangeRef = useRef(onChange);
  const onDrawingActiveChangeRef = useRef(onDrawingActiveChange);
  const sizeRef = useRef(size);
  const colorRef = useRef<string>(color);
  const strokeWidthRef = useRef(strokeWidth);
  const eraserRef = useRef(eraser);
  const activeStrokeIndexRef = useRef<number | null>(null);
  const lastPixelRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);
  useEffect(() => {
    editableRef.current = editable;
  }, [editable]);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onDrawingActiveChangeRef.current = onDrawingActiveChange;
  }, [onDrawingActiveChange]);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);
  useEffect(() => {
    colorRef.current = color;
  }, [color]);
  useEffect(() => {
    strokeWidthRef.current = strokeWidth;
  }, [strokeWidth]);
  useEffect(() => {
    eraserRef.current = eraser;
  }, [eraser]);

  const updateStrokes = (next: DrawGuessStroke[]) => {
    strokesRef.current = next;
    onChangeRef.current?.(next);
  };

  const pointFromEvent = (event: {
    nativeEvent: { locationX: number; locationY: number };
  }) => {
    const currentSize = sizeRef.current;
    return {
      normalized: {
        x: clamp(event.nativeEvent.locationX / currentSize.width),
        y: clamp(event.nativeEvent.locationY / currentSize.height),
      },
      pixel: {
        x: event.nativeEvent.locationX,
        y: event.nativeEvent.locationY,
      },
    };
  };

  const finishStroke = () => {
    activeStrokeIndexRef.current = null;
    lastPixelRef.current = null;
    onDrawingActiveChangeRef.current?.(false);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (event) =>
          editableRef.current && event.nativeEvent.touches.length <= 1,
        onMoveShouldSetPanResponder: () => editableRef.current,
        onPanResponderGrant: (event) => {
          if (!editableRef.current || event.nativeEvent.touches.length > 1) return;
          const current = strokesRef.current;
          if (current.length >= MAX_STROKES || countPoints(current) >= MAX_POINTS) return;
          const { normalized, pixel } = pointFromEvent(event);
          const next = [
            ...current,
            {
              color: eraserRef.current ? "#FFFFFF" : colorRef.current,
              width: eraserRef.current ? 0.045 : strokeWidthRef.current,
              points: [normalized],
            },
          ];
          activeStrokeIndexRef.current = next.length - 1;
          lastPixelRef.current = pixel;
          onDrawingActiveChangeRef.current?.(true);
          updateStrokes(next);
        },
        onPanResponderMove: (event) => {
          const strokeIndex = activeStrokeIndexRef.current;
          if (strokeIndex === null || event.nativeEvent.touches.length > 1) return;
          const current = strokesRef.current;
          if (countPoints(current) >= MAX_POINTS) return;
          const { normalized, pixel } = pointFromEvent(event);
          const lastPixel = lastPixelRef.current;
          if (
            lastPixel &&
            Math.hypot(pixel.x - lastPixel.x, pixel.y - lastPixel.y) < 2.4
          ) {
            return;
          }
          const stroke = current[strokeIndex];
          if (!stroke) return;
          const next = current.map((item, index) =>
            index === strokeIndex
              ? { ...item, points: [...item.points, normalized] }
              : item,
          );
          lastPixelRef.current = pixel;
          updateStrokes(next);
        },
        onPanResponderRelease: finishStroke,
        onPanResponderTerminate: finishStroke,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [],
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setSize({ width, height });
  };

  const selectColor = (nextColor: string, closePicker = false) => {
    setColor(nextColor);
    setEraser(false);
    if (closePicker) setColorPickerVisible(false);
    void Haptics.selectionAsync();
  };

  const undo = () => {
    if (strokesRef.current.length === 0) return;
    updateStrokes(strokesRef.current.slice(0, -1));
    void Haptics.selectionAsync();
  };

  const clear = () => {
    if (strokesRef.current.length === 0) return;
    AppAlert.alert("清空画板？", "画过的线条会全部消失。", [
      { text: "先留着", style: "cancel" },
      {
        text: "清空",
        style: "destructive",
        onPress: () => {
          updateStrokes([]);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <View
        style={styles.canvasShell}
        onLayout={handleLayout}
        {...(editable ? panResponder.panHandlers : {})}
      >
        <View pointerEvents="none" style={styles.paperLines} />
        <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
          {strokes.map((stroke, index) => (
            <Path
              key={`${index}-${stroke.points.length}`}
              path={pathForPoints(stroke.points, size.width, size.height)}
              color={stroke.color}
              style="stroke"
              strokeWidth={stroke.width * size.width}
              strokeCap="round"
              strokeJoin="round"
            />
          ))}
        </Canvas>
        {strokes.length === 0 && !editable ? (
          <View pointerEvents="none" style={styles.emptyCanvas}>
            <Ionicons name="image-outline" size={34} color={AppColors.textTertiary} />
            <Text style={styles.emptyCanvasText}>这幅画暂时没有内容</Text>
          </View>
        ) : null}
      </View>

      {editable ? (
        <View style={styles.tools}>
          <View style={styles.paletteRow}>
            {COMMON_COLORS.map((item) => (
              <TouchableOpacity
                key={item.value}
                style={[
                  styles.colorButton,
                  color === item.value && !eraser && styles.toolSelected,
                ]}
                onPress={() => selectColor(item.value)}
                accessibilityRole="button"
                accessibilityLabel={`选择${item.name}`}
              >
                <View style={[styles.colorDot, { backgroundColor: item.value }]} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[
                styles.iconTool,
                !eraser &&
                  !COMMON_COLOR_VALUES.has(color) &&
                  styles.toolSelected,
              ]}
              onPress={() => setColorPickerVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="选择更多颜色"
            >
              <Ionicons name="color-palette-outline" size={19} color={AppColors.text} />
              <View
                style={[styles.moreColorPreview, { backgroundColor: color }]}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconTool, eraser && styles.toolSelected]}
              onPress={() => {
                setEraser(true);
                void Haptics.selectionAsync();
              }}
              accessibilityRole="button"
              accessibilityLabel="橡皮擦"
            >
              <Ionicons name="bandage-outline" size={19} color={AppColors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.actionRow}>
            <View style={styles.widthGroup}>
              {WIDTHS.map((item) => (
                <TouchableOpacity
                  key={item}
                  style={[
                    styles.widthButton,
                    strokeWidth === item && !eraser && styles.toolSelected,
                  ]}
                  onPress={() => {
                    setStrokeWidth(item);
                    setEraser(false);
                    void Haptics.selectionAsync();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`画笔粗细 ${item}`}
                >
                  <View
                    style={[
                      styles.widthSample,
                      {
                        width: item === WIDTHS[0] ? 5 : item === WIDTHS[1] ? 9 : 14,
                        height: item === WIDTHS[0] ? 5 : item === WIDTHS[1] ? 9 : 14,
                        backgroundColor: eraser ? AppColors.textSecondary : color,
                      },
                    ]}
                  />
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.historyTools}>
              <TouchableOpacity
                style={[styles.textTool, strokes.length === 0 && styles.toolDisabled]}
                onPress={undo}
                disabled={strokes.length === 0}
              >
                <Ionicons name="arrow-undo" size={17} color={AppColors.textSecondary} />
                <Text style={styles.textToolLabel}>撤销</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.textTool, strokes.length === 0 && styles.toolDisabled]}
                onPress={clear}
                disabled={strokes.length === 0}
              >
                <Ionicons name="trash-outline" size={17} color={AppColors.danger} />
                <Text style={[styles.textToolLabel, { color: AppColors.danger }]}>清空</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      <Modal
        visible={editable && colorPickerVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setColorPickerVisible(false)}
      >
        <View style={styles.colorPickerOverlay}>
          <Pressable
            style={styles.colorPickerBackdrop}
            onPress={() => setColorPickerVisible(false)}
            accessibilityLabel="关闭颜色选择"
          />
          <SafeAreaView edges={["bottom"]} style={styles.colorPickerSheet}>
            <View style={styles.colorPickerHeader}>
              <View>
                <Text style={styles.colorPickerTitle}>更多颜色</Text>
                <Text style={styles.colorPickerSubtitle}>挑一个喜欢的颜色继续画</Text>
              </View>
              <TouchableOpacity
                style={styles.colorPickerClose}
                onPress={() => setColorPickerVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="关闭"
              >
                <Ionicons name="close" size={21} color={AppColors.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.colorPickerGrid}>
              {ALL_COLORS.map((item) => {
                const selected = !eraser && color === item.value;
                return (
                  <TouchableOpacity
                    key={item.value}
                    style={[
                      styles.colorPickerButton,
                      { backgroundColor: item.value },
                      selected && styles.colorPickerButtonSelected,
                    ]}
                    onPress={() => selectColor(item.value, true)}
                    accessibilityRole="button"
                    accessibilityLabel={`选择${item.name}`}
                    accessibilityState={{ selected }}
                  >
                    {selected ? (
                      <Ionicons
                        name="checkmark"
                        size={22}
                        color={
                          LIGHT_COLOR_VALUES.has(item.value)
                            ? AppColors.text
                            : "#FFFFFF"
                        }
                      />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: "100%",
    gap: 10,
  },
  canvasShell: {
    width: "100%",
    aspectRatio: 1,
    overflow: "hidden",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(47,47,47,0.14)",
    backgroundColor: "#FFFFFF",
    shadowColor: "#392A20",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  paperLines: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.45,
    borderWidth: 8,
    borderColor: "rgba(217,199,166,0.13)",
    borderRadius: 21,
  },
  emptyCanvas: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  emptyCanvasText: {
    color: AppColors.textTertiary,
    fontSize: 13,
  },
  tools: {
    gap: 9,
    padding: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: "rgba(255,255,255,0.88)",
  },
  paletteRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 5,
  },
  colorButton: {
    width: 35,
    height: 35,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  colorDot: {
    width: 23,
    height: 23,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(47,47,47,0.10)",
  },
  iconTool: {
    width: 35,
    height: 35,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: "rgba(47,47,47,0.05)",
  },
  moreColorPreview: {
    position: "absolute",
    right: 3,
    bottom: 3,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
  toolSelected: {
    borderColor: AppColors.primary,
    backgroundColor: "rgba(147,181,208,0.14)",
  },
  actionRow: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  widthGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  widthButton: {
    width: 38,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  widthSample: {
    borderRadius: 99,
  },
  historyTools: {
    flexDirection: "row",
    gap: 5,
  },
  textTool: {
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    borderRadius: 11,
    backgroundColor: "rgba(47,47,47,0.05)",
  },
  textToolLabel: {
    color: AppColors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  toolDisabled: {
    opacity: 0.35,
  },
  colorPickerOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  colorPickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(35,30,28,0.34)",
  },
  colorPickerSheet: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    gap: 18,
    paddingTop: 18,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: "#FFFEFC",
    shadowColor: "#2F2520",
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -5 },
    elevation: 14,
  },
  colorPickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  colorPickerTitle: {
    color: AppColors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  colorPickerSubtitle: {
    marginTop: 3,
    color: AppColors.textSecondary,
    fontSize: 11,
  },
  colorPickerClose: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: "rgba(47,47,47,0.055)",
  },
  colorPickerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
  },
  colorPickerButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "rgba(47,47,47,0.08)",
  },
  colorPickerButtonSelected: {
    borderWidth: 3,
    borderColor: AppColors.primary,
    shadowColor: AppColors.primary,
    shadowOpacity: 0.26,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
