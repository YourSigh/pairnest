import Ionicons from "@expo/vector-icons/Ionicons";
import { createThemedStyleSheet } from "@/constants/theme";
import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";

export type PetNewcomerGuideProps = {
  visible: boolean;
  petName: string;
  onClose: () => void;
  onOpenShop: () => void;
};

type GuideStep = {
  eyebrow: string;
  title: (petName: string) => string;
  detail: (petName: string) => string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
  tint: string;
};

const GUIDE_STEPS: GuideStep[] = [
  {
    eyebrow: "自由陪伴",
    title: (petName) => `先和${petName}打个招呼`,
    detail: (petName) =>
      `点场景里的任意地面，${petName}就会跑过去探索；直接点它，还能摸摸头、听听它现在想做什么。`,
    icon: "paw",
    accent: "#DB7F9B",
    tint: "#FCE9EF",
  },
  {
    eyebrow: "读懂心情",
    title: (petName) => `${petName}也有自己的小心愿`,
    detail: () =>
      "饱腹、开心、清洁和活力会慢慢变化。优先完成今天的小心愿，会得到额外爱心，也更容易看见特别反应。",
    icon: "sparkles",
    accent: "#C48A52",
    tint: "#FFF1D9",
  },
  {
    eyebrow: "一起布置",
    title: () => "把这里变成你们共同的家",
    detail: (petName) =>
      `点右上角「布置」就能打开共同商店。先从新手低价玩具开始吧，摆进房间后，${petName}真的会跑去玩。`,
    icon: "storefront",
    accent: "#738EAE",
    tint: "#E9F2FA",
  },
  {
    eyebrow: "安心作息",
    title: (petName) => `${petName}会记得好好睡觉`,
    detail: (petName) =>
      `每天 23:00–07:00，${petName}会自动回窝休息。夜里叫醒它，它会先陪你一会儿，再乖乖回去入睡。`,
    icon: "moon",
    accent: "#8178B3",
    tint: "#EEEAFB",
  },
];

function WalkingArtwork({ petName }: { petName: string }) {
  return (
    <View style={styles.roomArtwork}>
      <View style={styles.window}>
        <View style={styles.windowCloud} />
        <View style={styles.windowHill} />
      </View>
      <View style={styles.floorLine} />
      <View style={[styles.pathDot, styles.pathDotOne]} />
      <View style={[styles.pathDot, styles.pathDotTwo]} />
      <View style={[styles.pathDot, styles.pathDotThree]} />
      <View style={styles.destination}>
        <Ionicons name="navigate" size={15} color="#D87793" />
      </View>
      <View style={styles.dogBubble}>
        <View style={styles.dogEarLeft} />
        <View style={styles.dogEarRight} />
        <Ionicons name="paw" size={28} color="#9E766A" />
      </View>
      <View style={styles.touchHint}>
        <Ionicons name="hand-left-outline" size={14} color="#805F68" />
        <ThemedText numberOfLines={1} style={styles.touchHintText}>点地面 · 点{petName}</ThemedText>
      </View>
    </View>
  );
}

function StatusArtwork() {
  return (
    <View style={styles.statusArtwork}>
      <View style={styles.statusColumn}>
        <View style={styles.miniStatusRow}>
          <View style={[styles.statusIcon, styles.foodIcon]}>
            <Ionicons name="restaurant" size={13} color="#C07D46" />
          </View>
          <View style={styles.miniTrack}>
            <View style={[styles.miniFill, styles.foodFill]} />
          </View>
        </View>
        <View style={styles.miniStatusRow}>
          <View style={[styles.statusIcon, styles.happyIcon]}>
            <Ionicons name="heart" size={13} color="#D87994" />
          </View>
          <View style={styles.miniTrack}>
            <View style={[styles.miniFill, styles.happyFill]} />
          </View>
        </View>
        <View style={styles.miniStatusRow}>
          <View style={[styles.statusIcon, styles.cleanIcon]}>
            <Ionicons name="water" size={13} color="#6E9DB7" />
          </View>
          <View style={styles.miniTrack}>
            <View style={[styles.miniFill, styles.cleanFill]} />
          </View>
        </View>
      </View>
      <View style={styles.wishCard}>
        <View style={styles.wishSparkle}>
          <Ionicons name="sparkles" size={18} color="#C8864F" />
        </View>
        <View style={styles.wishCopy}>
          <ThemedText style={styles.wishLabel}>今天的小心愿</ThemedText>
          <ThemedText style={styles.wishText}>想和你追一次飞盘！</ThemedText>
        </View>
        <View style={styles.wishReward}>
          <Ionicons name="heart" size={10} color="#D87D98" />
          <ThemedText style={styles.wishRewardText}>+20</ThemedText>
        </View>
      </View>
    </View>
  );
}

function ShopArtwork() {
  return (
    <View style={styles.shopArtwork}>
      <View style={styles.fakeHeader}>
        <View style={styles.fakeBack}>
          <Ionicons name="chevron-back" size={14} color="#8A747A" />
        </View>
        <View style={styles.fakeTitleLine} />
        <View style={styles.decorateButton}>
          <Ionicons name="color-palette-outline" size={14} color="#FFFFFF" />
          <ThemedText style={styles.decorateText}>布置</ThemedText>
        </View>
      </View>
      <View style={styles.shopShelf}>
        <View style={styles.toyCard}>
          <View style={styles.toyIcon}>
            <Ionicons name="gift" size={31} color="#FFFFFF" />
          </View>
          <View style={styles.newcomerTag}>
            <ThemedText style={styles.newcomerTagText}>新手低价</ThemedText>
          </View>
          <ThemedText style={styles.toyName}>第一件小玩具</ThemedText>
          <View style={styles.toyPrice}>
            <Ionicons name="heart" size={11} color="#D87994" />
            <ThemedText style={styles.toyPriceText}>很快就能带回家</ThemedText>
          </View>
        </View>
        <View style={styles.shopArrow}>
          <Ionicons name="arrow-forward" size={20} color="#7891AD" />
        </View>
      </View>
    </View>
  );
}

function SleepArtwork({ petName }: { petName: string }) {
  return (
    <View style={styles.sleepArtwork}>
      <View style={styles.nightWindow}>
        <Ionicons name="moon" size={30} color="#FFF2B8" />
        <View style={[styles.star, styles.starOne]} />
        <View style={[styles.star, styles.starTwo]} />
        <View style={[styles.star, styles.starThree]} />
      </View>
      <View style={styles.clockPill}>
        <Ionicons name="time-outline" size={14} color="#69638D" />
        <ThemedText style={styles.clockText}>23:00 – 07:00</ThemedText>
      </View>
      <View style={styles.petBed}>
        <View style={styles.sleepingDog}>
          <Ionicons name="paw" size={26} color="#9E817B" />
        </View>
        <ThemedText numberOfLines={1} style={styles.sleepLabel}>{petName}的晚安窝</ThemedText>
      </View>
      <ThemedText style={styles.zzz}>z Z</ThemedText>
    </View>
  );
}

function StepArtwork({ step, petName }: { step: number; petName: string }) {
  if (step === 0) return <WalkingArtwork petName={petName} />;
  if (step === 1) return <StatusArtwork />;
  if (step === 2) return <ShopArtwork />;
  return <SleepArtwork petName={petName} />;
}

export function PetNewcomerGuide({
  visible,
  petName,
  onClose,
  onOpenShop,
}: PetNewcomerGuideProps) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const [step, setStep] = useState(0);
  const compact = height < 700 || width < 360;
  const name = petName.trim() || "小栖";
  const current = GUIDE_STEPS[step];
  const lastStep = step === GUIDE_STEPS.length - 1;
  const modalHeight = Math.min(
    compact ? 560 : 650,
    Math.max(340, height - Math.max(insets.top, 12) - Math.max(insets.bottom, 12) - 20),
  );

  useEffect(() => {
    if (visible) setStep(0);
  }, [visible]);

  const goBack = () => setStep((value) => Math.max(0, value - 1));
  const goForward = () => {
    if (lastStep) {
      onOpenShop();
      return;
    }
    setStep((value) => Math.min(GUIDE_STEPS.length - 1, value + 1));
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.root,
          {
            paddingTop: Math.max(insets.top, 12),
            paddingBottom: Math.max(insets.bottom, 12),
          },
        ]}
      >
        <View style={styles.backdrop} />
        <View
          accessibilityViewIsModal
          style={[styles.card, { maxHeight: modalHeight }, compact && styles.cardCompact]}
        >
          <View style={styles.topBar}>
            <View style={styles.brandPill}>
              <Ionicons name="paw" size={12} color="#D77D98" />
              <ThemedText style={styles.brandText}>小栖小屋 · 初次见面</ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="跳过新手引导"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [styles.skipButton, pressed && styles.buttonPressed]}
            >
              <ThemedText style={styles.skipText}>跳过</ThemedText>
              <Ionicons name="close" size={15} color="#947E85" />
            </Pressable>
          </View>

          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            style={styles.scroll}
            contentContainerStyle={[styles.content, compact && styles.contentCompact]}
          >
            <View
              style={[
                styles.artworkFrame,
                { backgroundColor: current.tint },
                compact && styles.artworkFrameCompact,
              ]}
            >
              <View style={[styles.artworkGlow, { backgroundColor: current.accent }]} />
              <StepArtwork step={step} petName={name} />
            </View>

            <View style={styles.copy} accessibilityLiveRegion="polite">
              <View style={[styles.eyebrow, { backgroundColor: current.tint }]}>
                <Ionicons name={current.icon} size={13} color={current.accent} />
                <ThemedText style={[styles.eyebrowText, { color: current.accent }]}>
                  {current.eyebrow}
                </ThemedText>
              </View>
              <ThemedText style={[styles.title, compact && styles.titleCompact]}>
                {current.title(name)}
              </ThemedText>
              <ThemedText style={[styles.detail, compact && styles.detailCompact]}>
                {current.detail(name)}
              </ThemedText>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <View
              accessibilityLabel={`第 ${step + 1} 步，共 ${GUIDE_STEPS.length} 步`}
              style={styles.progress}
            >
              {GUIDE_STEPS.map((item, index) => (
                <View
                  key={item.eyebrow}
                  style={[
                    styles.progressDot,
                    index === step && [styles.progressDotActive, { backgroundColor: current.accent }],
                    index < step && styles.progressDotDone,
                  ]}
                />
              ))}
            </View>

            <View style={styles.actions}>
              {step > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={goBack}
                  style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}
                >
                  <Ionicons name="chevron-back" size={17} color="#846F76" />
                  <ThemedText style={styles.backButtonText}>上一步</ThemedText>
                </Pressable>
              ) : <View style={styles.backPlaceholder} />}

              <Pressable
                accessibilityRole="button"
                onPress={goForward}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: current.accent },
                  lastStep && styles.primaryButtonWide,
                  pressed && styles.buttonPressed,
                ]}
              >
                <ThemedText numberOfLines={1} style={styles.primaryButtonText}>
                  {lastStep ? "去挑第一件礼物" : "继续看看"}
                </ThemedText>
                <Ionicons
                  name={lastStep ? "gift-outline" : "chevron-forward"}
                  size={17}
                  color="#FFFFFF"
                />
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = createThemedStyleSheet({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(49, 38, 42, 0.58)",
  },
  card: {
    width: "100%",
    maxWidth: 430,
    overflow: "hidden",
    borderRadius: 30,
    backgroundColor: "#FFFCFA",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,.95)",
    shadowColor: "#392B30",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.24,
    shadowRadius: 28,
    elevation: 18,
  },
  cardCompact: {
    borderRadius: 24,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 17,
    paddingBottom: 8,
  },
  brandPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#FBECEF",
  },
  brandText: {
    color: "#9A6C79",
    fontSize: 11,
    fontWeight: "700",
  },
  skipButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minHeight: 34,
    paddingLeft: 10,
  },
  skipText: {
    color: "#947E85",
    fontSize: 12,
    fontWeight: "600",
  },
  scroll: {
    flexShrink: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 14,
  },
  contentCompact: {
    paddingHorizontal: 15,
    paddingTop: 2,
    paddingBottom: 8,
  },
  artworkFrame: {
    height: 224,
    overflow: "hidden",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.86)",
  },
  artworkFrameCompact: {
    height: 178,
    borderRadius: 20,
  },
  artworkGlow: {
    position: "absolute",
    width: 170,
    height: 170,
    top: -88,
    right: -50,
    borderRadius: 90,
    opacity: 0.12,
  },
  copy: {
    alignItems: "center",
    paddingHorizontal: 4,
    paddingTop: 19,
  },
  eyebrow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99,
    marginBottom: 10,
  },
  eyebrowText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  title: {
    color: "#4C3D42",
    fontSize: 23,
    lineHeight: 31,
    fontWeight: "800",
    textAlign: "center",
  },
  titleCompact: {
    fontSize: 20,
    lineHeight: 27,
  },
  detail: {
    color: "#827177",
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 9,
  },
  detailCompact: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#F0E4E5",
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 17,
    backgroundColor: "#FFFCFA",
  },
  progress: {
    flexDirection: "row",
    alignSelf: "center",
    alignItems: "center",
    gap: 7,
    minHeight: 12,
    marginBottom: 10,
  },
  progressDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#E6DADC",
  },
  progressDotActive: {
    width: 23,
  },
  progressDotDone: {
    backgroundColor: "#CDAEB7",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  backButton: {
    minWidth: 86,
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "#F5EFF0",
  },
  backPlaceholder: {
    width: 86,
  },
  backButtonText: {
    color: "#846F76",
    fontSize: 13,
    fontWeight: "700",
  },
  primaryButton: {
    minWidth: 128,
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 18,
    borderRadius: 16,
    shadowColor: "#6E525C",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.2,
    shadowRadius: 9,
    elevation: 4,
  },
  primaryButtonWide: {
    minWidth: 184,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  buttonPressed: {
    opacity: 0.72,
  },
  roomArtwork: {
    flex: 1,
    overflow: "hidden",
  },
  window: {
    position: "absolute",
    top: 18,
    right: 24,
    width: 91,
    height: 65,
    overflow: "hidden",
    borderRadius: 14,
    borderWidth: 5,
    borderColor: "rgba(255,255,255,0.88)",
    backgroundColor: "#BDE0E7",
  },
  windowCloud: {
    position: "absolute",
    top: 12,
    left: 16,
    width: 35,
    height: 10,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.8)",
  },
  windowHill: {
    position: "absolute",
    width: 100,
    height: 45,
    borderRadius: 50,
    left: -10,
    bottom: -27,
    backgroundColor: "#9CCFB6",
  },
  floorLine: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: "34%",
    height: 2,
    backgroundColor: "rgba(214, 155, 170, 0.14)",
  },
  dogBubble: {
    position: "absolute",
    left: "14%",
    bottom: "18%",
    width: 76,
    height: 76,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 40,
    borderWidth: 5,
    borderColor: "#FFFFFF",
    backgroundColor: "#F5ECE4",
    shadowColor: "#8D6E72",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  dogEarLeft: {
    position: "absolute",
    top: -7,
    left: 10,
    width: 22,
    height: 25,
    borderRadius: 5,
    backgroundColor: "#F5ECE4",
    transform: [{ rotate: "-25deg" }],
  },
  dogEarRight: {
    position: "absolute",
    top: -7,
    right: 10,
    width: 22,
    height: 25,
    borderRadius: 5,
    backgroundColor: "#F5ECE4",
    transform: [{ rotate: "25deg" }],
  },
  pathDot: {
    position: "absolute",
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#D98A9F",
    opacity: 0.65,
  },
  pathDotOne: {
    left: "37%",
    bottom: "27%",
  },
  pathDotTwo: {
    left: "50%",
    bottom: "35%",
  },
  pathDotThree: {
    left: "62%",
    bottom: "43%",
  },
  destination: {
    position: "absolute",
    left: "72%",
    bottom: "46%",
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
  },
  touchHint: {
    position: "absolute",
    left: 17,
    top: 18,
    maxWidth: "57%",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.86)",
  },
  touchHintText: {
    flexShrink: 1,
    color: "#805F68",
    fontSize: 11,
    fontWeight: "700",
  },
  statusArtwork: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 13,
    paddingHorizontal: 14,
  },
  statusColumn: {
    width: "31%",
    gap: 11,
    padding: 12,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.78)",
  },
  miniStatusRow: {
    gap: 6,
  },
  statusIcon: {
    width: 25,
    height: 25,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
  },
  foodIcon: {
    backgroundColor: "#FFF0D9",
  },
  happyIcon: {
    backgroundColor: "#FAE5EB",
  },
  cleanIcon: {
    backgroundColor: "#E3F1F7",
  },
  miniTrack: {
    height: 6,
    overflow: "hidden",
    borderRadius: 4,
    backgroundColor: "#F1E8E3",
  },
  miniFill: {
    height: "100%",
    borderRadius: 4,
  },
  foodFill: {
    width: "78%",
    backgroundColor: "#DCA66E",
  },
  happyFill: {
    width: "92%",
    backgroundColor: "#DD829B",
  },
  cleanFill: {
    width: "66%",
    backgroundColor: "#76A9C1",
  },
  wishCard: {
    width: "59%",
    minHeight: 108,
    flexDirection: "row",
    alignItems: "center",
    padding: 13,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: "rgba(208, 153, 93, 0.16)",
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  wishSparkle: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: "#FFF0D6",
  },
  wishCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 9,
  },
  wishLabel: {
    color: "#AA7550",
    fontSize: 10,
    fontWeight: "800",
  },
  wishText: {
    color: "#624F45",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    marginTop: 3,
  },
  wishReward: {
    position: "absolute",
    right: 9,
    top: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  wishRewardText: {
    color: "#D87D98",
    fontSize: 9,
    fontWeight: "800",
  },
  shopArtwork: {
    flex: 1,
    padding: 15,
  },
  fakeHeader: {
    height: 43,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 15,
    paddingHorizontal: 9,
    backgroundColor: "rgba(255,255,255,0.82)",
  },
  fakeBack: {
    width: 27,
    height: 27,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#F2EAEB",
  },
  fakeTitleLine: {
    width: 73,
    height: 7,
    borderRadius: 4,
    marginLeft: 10,
    backgroundColor: "#DDCFD2",
  },
  decorateButton: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: "#7D95B2",
  },
  decorateText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
  },
  shopShelf: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  toyCard: {
    width: "67%",
    minHeight: 112,
    alignItems: "center",
    justifyContent: "center",
    padding: 10,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  toyIcon: {
    width: 53,
    height: 53,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: "#EAB17A",
  },
  newcomerTag: {
    position: "absolute",
    top: 8,
    right: 8,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: "#FBE4EA",
  },
  newcomerTagText: {
    color: "#C66E89",
    fontSize: 8,
    fontWeight: "800",
  },
  toyName: {
    color: "#66535A",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 6,
  },
  toyPrice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 2,
  },
  toyPriceText: {
    color: "#9B858C",
    fontSize: 9,
    fontWeight: "600",
  },
  shopArrow: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    marginLeft: 8,
    backgroundColor: "rgba(255,255,255,0.76)",
  },
  sleepArtwork: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: "#555278",
  },
  nightWindow: {
    position: "absolute",
    top: 17,
    right: 19,
    width: 94,
    height: 75,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    borderWidth: 5,
    borderColor: "rgba(255,255,255,0.74)",
    backgroundColor: "#4A496D",
  },
  star: {
    position: "absolute",
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#FFF6D5",
  },
  starOne: {
    left: 14,
    top: 13,
  },
  starTwo: {
    right: 15,
    top: 18,
  },
  starThree: {
    left: 20,
    bottom: 13,
  },
  clockPill: {
    position: "absolute",
    left: 16,
    top: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.87)",
  },
  clockText: {
    color: "#69638D",
    fontSize: 11,
    fontWeight: "800",
  },
  petBed: {
    position: "absolute",
    left: "17%",
    bottom: 21,
    width: "66%",
    height: 82,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 35,
    borderWidth: 5,
    borderColor: "rgba(255,255,255,0.42)",
    backgroundColor: "#B7A8C7",
  },
  sleepingDog: {
    width: 56,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    backgroundColor: "#F3E8E2",
  },
  sleepLabel: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 3,
  },
  zzz: {
    position: "absolute",
    left: "66%",
    bottom: 86,
    color: "#FFF4C7",
    fontSize: 16,
    fontWeight: "800",
    transform: [{ rotate: "-12deg" }],
  },
});
