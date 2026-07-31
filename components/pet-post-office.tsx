import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { ThemedText } from "@/components/themed-text";
import type {
  PetLetter,
  PetLetterResponse,
  PetLetterTheme,
  PetMailbox,
} from "@/services/PetService";

const THEMES: {
  key: PetLetterTheme;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "miss", label: "想你啦", icon: "heart" },
  { key: "cheer", label: "给你加油", icon: "flash" },
  { key: "hug", label: "抱抱申请", icon: "happy" },
  { key: "thanks", label: "谢谢你", icon: "flower" },
  { key: "goodnight", label: "睡前话", icon: "moon" },
  { key: "question", label: "问问你", icon: "help-circle" },
];

const RESPONSES: {
  key: PetLetterResponse;
  label: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "hug", label: "抱抱小栖", detail: "带着暖暖的拥抱回家", icon: "heart" },
  { key: "cookie", label: "奖励饼干", detail: "嘴角沾着饼干香回家", icon: "nutrition" },
  { key: "paw", label: "盖个爪印", detail: "带回一枚认真的小爪印", icon: "paw" },
];

type ModalMode = "compose" | "reply" | "complete" | null;

function themeLabel(theme: PetLetterTheme) {
  return THEMES.find((item) => item.key === theme)?.label ?? "一封心意";
}

function statusCopy(active: PetLetter) {
  if (active.direction === "incoming" && active.status === "waiting") {
    return { eyebrow: "汪！有你的信", title: "小栖叼着一封心意回来啦", button: "拆开看看" };
  }
  if (active.direction === "incoming" && active.status === "opened") {
    return { eyebrow: "小栖还在等你", title: "选一份回程礼物带给 TA", button: "准备回礼" };
  }
  if (active.direction === "outgoing" && active.status === "returned") {
    return { eyebrow: "小栖回家啦", title: "TA 给你准备了一份回礼", button: "打开回程包" };
  }
  if (active.direction === "outgoing" && active.status === "opened") {
    return { eyebrow: "信已经拆开啦", title: "小栖正在等 TA 准备回礼", button: "耐心等等" };
  }
  return { eyebrow: "小栖正在送信", title: "它会把你的心意好好送到", button: "送信中" };
}

export function PetPostOffice({
  mailbox,
  onSend,
  onOpen,
  onReply,
}: {
  mailbox: PetMailbox;
  onSend: (input: {
    theme: PetLetterTheme;
    satchel: "pink" | "blue" | "cream";
    message: string;
  }) => Promise<boolean>;
  onOpen: (id: string) => Promise<PetMailbox | null>;
  onReply: (
    id: string,
    responseKind: PetLetterResponse,
    responseText: string,
  ) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<ModalMode>(null);
  const [preview, setPreview] = useState<PetLetter | null>(null);
  const [theme, setTheme] = useState<PetLetterTheme>("miss");
  const [satchel, setSatchel] = useState<"pink" | "blue" | "cream">("pink");
  const [message, setMessage] = useState("");
  const [responseKind, setResponseKind] = useState<PetLetterResponse>("hug");
  const [responseText, setResponseText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const active = mailbox.active;
  const copy = active ? statusCopy(active) : null;
  const canSend = !active && mailbox.sentToday < mailbox.sendLimit;

  const handleCardPress = async () => {
    if (!active) {
      if (canSend) setMode("compose");
      return;
    }
    if (active.direction === "incoming" && active.status === "waiting") {
      setSubmitting(true);
      try {
        const next = await onOpen(active.id);
        if (next) {
          setPreview(next.active);
          setMode("reply");
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }
    if (active.direction === "incoming" && active.status === "opened") {
      setPreview(active);
      setMode("reply");
      return;
    }
    if (active.direction === "outgoing" && active.status === "returned") {
      setPreview(active);
      setSubmitting(true);
      try {
        const next = await onOpen(active.id);
        if (next) setMode("complete");
      } finally {
        setSubmitting(false);
      }
    }
  };

  const send = async () => {
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    try {
      if (await onSend({ theme, satchel, message: message.trim() })) {
        setMessage("");
        setMode(null);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const reply = async () => {
    if (!preview || submitting) return;
    setSubmitting(true);
    try {
      if (await onReply(preview.id, responseKind, responseText.trim())) {
        setResponseText("");
        setMode(null);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Pressable
        onPress={() => void handleCardPress()}
        style={({ pressed }) => [
          styles.card,
          active?.canOpen && styles.cardAttention,
          pressed && styles.pressed,
        ]}
      >
        <View style={[styles.dogIcon, active?.canOpen && styles.dogIconAttention]}>
          <Ionicons
            name={active ? "mail" : "paper-plane"}
            size={24}
            color="#FFF"
          />
          {active?.canOpen && <View style={styles.unreadDot} />}
        </View>
        <View style={styles.copy}>
          <ThemedText style={styles.eyebrow}>
            {copy?.eyebrow ?? "小栖邮局"}
          </ThemedText>
          <ThemedText style={styles.title}>
            {copy?.title ?? "让小栖替你送一份心意"}
          </ThemedText>
          <ThemedText style={styles.detail}>
            {active
              ? `${themeLabel(active.theme)} · 第 ${mailbox.postmanTrips + 1} 趟旅程`
              : mailbox.sentToday >= mailbox.sendLimit
                ? "今天已经认真送过两趟，明天再出发"
                : `今天还可以出发 ${mailbox.sendLimit - mailbox.sentToday} 次`}
          </ThemedText>
        </View>
        <View style={styles.cardButton}>
          {submitting ? (
            <ActivityIndicator size="small" color="#C66682" />
          ) : (
            <>
              <ThemedText style={styles.cardButtonText}>
                {copy?.button ?? (canSend ? "写一封" : "休息中")}
              </ThemedText>
              {(active?.canOpen || canSend) && (
                <Ionicons name="chevron-forward" size={13} color="#C66682" />
              )}
            </>
          )}
        </View>
      </Pressable>

      <Modal visible={mode !== null} transparent animationType="slide" onRequestClose={() => setMode(null)}>
        <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMode(null)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            {mode === "compose" && (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
              >
                <ThemedText style={styles.sheetEyebrow}>装好一份心意</ThemedText>
                <ThemedText style={styles.sheetTitle}>交给小栖送给 TA</ThemedText>
                <ThemedText style={styles.fieldLabel}>选择一枚心意印章</ThemedText>
                <View style={styles.themeGrid}>
                  {THEMES.map((item) => (
                    <Pressable
                      key={item.key}
                      onPress={() => setTheme(item.key)}
                      style={[styles.theme, theme === item.key && styles.themeActive]}
                    >
                      <Ionicons name={item.icon} size={17} color={theme === item.key ? "#FFF" : "#C56F87"} />
                      <ThemedText style={[styles.themeText, theme === item.key && styles.themeTextActive]}>{item.label}</ThemedText>
                    </Pressable>
                  ))}
                </View>
                <ThemedText style={styles.fieldLabel}>想让小栖带什么话？</ThemedText>
                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  maxLength={80}
                  placeholder="写一句平时没来得及说的话…"
                  placeholderTextColor="#BAA4AB"
                  style={styles.textarea}
                />
                <ThemedText style={styles.counter}>{message.length}/80</ThemedText>
                <ThemedText style={styles.fieldLabel}>挑一个邮差包</ThemedText>
                <View style={styles.satchels}>
                  {(["pink", "blue", "cream"] as const).map((item) => (
                    <Pressable
                      key={item}
                      onPress={() => setSatchel(item)}
                      style={[
                        styles.satchel,
                        { backgroundColor: item === "pink" ? "#EB8DA7" : item === "blue" ? "#85ADD8" : "#D6B585" },
                        satchel === item && styles.satchelActive,
                      ]}
                    >
                      <Ionicons name="mail" size={20} color="#FFF" />
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  disabled={!message.trim() || submitting}
                  onPress={() => void send()}
                  style={[styles.primary, (!message.trim() || submitting) && styles.primaryDisabled]}
                >
                  {submitting ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="paw" size={18} color="#FFF" /><ThemedText style={styles.primaryText}>交给小栖，出发！</ThemedText></>}
                </Pressable>
              </ScrollView>
            )}

            {mode === "reply" && preview && (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
              >
                <ThemedText style={styles.sheetEyebrow}>小栖替 TA 送来的</ThemedText>
                <ThemedText style={styles.sheetTitle}>{themeLabel(preview.theme)}</ThemedText>
                <View style={styles.letterPaper}>
                  <Ionicons name="heart" size={18} color="#DC7D97" />
                  <ThemedText style={styles.letterText}>{preview.message}</ThemedText>
                  <View style={styles.pawStamp}><Ionicons name="paw" size={16} color="#D99CB0" /></View>
                </View>
                <ThemedText style={styles.fieldLabel}>怎么招待送信的小栖？</ThemedText>
                {RESPONSES.map((item) => (
                  <Pressable
                    key={item.key}
                    onPress={() => setResponseKind(item.key)}
                    style={[styles.response, responseKind === item.key && styles.responseActive]}
                  >
                    <View style={styles.responseIcon}><Ionicons name={item.icon} size={18} color="#D3748E" /></View>
                    <View style={styles.responseCopy}><ThemedText style={styles.responseTitle}>{item.label}</ThemedText><ThemedText style={styles.responseDetail}>{item.detail}</ThemedText></View>
                    <Ionicons name={responseKind === item.key ? "radio-button-on" : "radio-button-off"} size={18} color="#D77F98" />
                  </Pressable>
                ))}
                <TextInput
                  value={responseText}
                  onChangeText={setResponseText}
                  maxLength={40}
                  placeholder="也可以让小栖带一句回话…"
                  placeholderTextColor="#BAA4AB"
                  style={styles.replyInput}
                />
                <Pressable disabled={submitting} onPress={() => void reply()} style={styles.primary}>
                  {submitting ? <ActivityIndicator color="#FFF" /> : <><Ionicons name="heart" size={17} color="#FFF" /><ThemedText style={styles.primaryText}>让小栖带着回礼回家</ThemedText></>}
                </Pressable>
              </ScrollView>
            )}

            {mode === "complete" && preview && (
              <View>
                <ThemedText style={styles.sheetEyebrow}>第 {mailbox.postmanTrips + 1} 趟旅程完成</ThemedText>
                <ThemedText style={styles.sheetTitle}>小栖把 TA 的心意带回来啦</ThemedText>
                <View style={styles.completeGift}>
                  <Ionicons name={preview.responseKind === "cookie" ? "nutrition" : preview.responseKind === "paw" ? "paw" : "heart"} size={34} color="#D87994" />
                  <ThemedText style={styles.completeTitle}>{RESPONSES.find((item) => item.key === preview.responseKind)?.label ?? "暖暖的回礼"}</ThemedText>
                  {preview.responseText ? <ThemedText style={styles.completeText}>“{preview.responseText}”</ThemedText> : null}
                </View>
                <ThemedText style={styles.completeHint}>这趟旅程已经收进小栖的邮差日记</ThemedText>
                <Pressable onPress={() => setMode(null)} style={styles.primary}>
                  <ThemedText style={styles.primaryText}>抱抱回家的小栖</ThemedText>
                </Pressable>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 13,
    minHeight: 96,
    padding: 14,
    borderRadius: 24,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,.94)",
    borderWidth: 1.5,
    borderColor: "#F0E1E5",
    shadowColor: "#8B6570",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardAttention: { backgroundColor: "#FFF4F7", borderColor: "#EFA8BA" },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.9 },
  dogIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#B797A3",
    shadowColor: "#8B6570",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  dogIconAttention: { backgroundColor: "#E27D99" },
  unreadDot: { position: "absolute", right: -2, top: -2, width: 12, height: 12, borderRadius: 6, backgroundColor: "#F1B04E", borderWidth: 2, borderColor: "#FFF" },
  copy: { flex: 1, marginLeft: 11 },
  eyebrow: { color: "#BF7187", fontSize: 9, fontWeight: "900" },
  title: { color: "#604D53", fontSize: 13, fontWeight: "900", marginTop: 2 },
  detail: { color: "#A18B92", fontSize: 9, marginTop: 3 },
  cardButton: { minWidth: 64, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2 },
  cardButtonText: { color: "#C66682", fontSize: 9, fontWeight: "900" },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(57,38,44,.32)" },
  sheet: {
    maxHeight: "88%",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 22,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: "#FFF9F6",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.95)",
  },
  handle: { alignSelf: "center", width: 42, height: 5, borderRadius: 3, backgroundColor: "#E0CDD2", marginBottom: 14 },
  sheetEyebrow: { color: "#CA738B", fontSize: 10, fontWeight: "900" },
  sheetTitle: { color: "#57464C", fontSize: 21, fontWeight: "900", marginTop: 3 },
  fieldLabel: { color: "#755F66", fontSize: 11, fontWeight: "900", marginTop: 18, marginBottom: 8 },
  themeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  theme: { width: "31.5%", height: 39, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: "#F8EAEE" },
  themeActive: { backgroundColor: "#DC7D98" },
  themeText: { color: "#9B6675", fontSize: 9, fontWeight: "800" },
  themeTextActive: { color: "#FFF" },
  textarea: { height: 92, borderRadius: 17, paddingHorizontal: 13, paddingVertical: 11, textAlignVertical: "top", backgroundColor: "#FFF", borderWidth: 1, borderColor: "#EEDDE2", color: "#59494F", fontSize: 13 },
  counter: { alignSelf: "flex-end", color: "#B49EA5", fontSize: 8, marginTop: 4 },
  satchels: { flexDirection: "row", gap: 12 },
  satchel: { width: 47, height: 39, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "transparent" },
  satchelActive: { borderColor: "#FFF", shadowColor: "#9E6878", shadowOpacity: 0.25, shadowRadius: 5, elevation: 3 },
  primary: {
    height: 49,
    borderRadius: 17,
    marginTop: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#DF819B",
    shadowColor: "#DF819B",
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  primaryDisabled: { opacity: 0.45 },
  primaryText: { color: "#FFF", fontSize: 12, fontWeight: "900" },
  letterPaper: {
    minHeight: 114,
    marginTop: 16,
    padding: 17,
    borderRadius: 18,
    backgroundColor: "#FFF0E5",
    borderWidth: 1,
    borderColor: "#EED8C6",
    shadowColor: "#8B6570",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  letterText: { color: "#665258", fontSize: 14, lineHeight: 22, fontWeight: "700", marginTop: 8 },
  pawStamp: { position: "absolute", right: 13, bottom: 11, transform: [{ rotate: "-12deg" }] },
  response: { minHeight: 59, marginBottom: 7, paddingHorizontal: 10, borderRadius: 16, flexDirection: "row", alignItems: "center", backgroundColor: "#FFF", borderWidth: 1.5, borderColor: "#EFE2E5" },
  responseActive: { borderColor: "#E49AB0", backgroundColor: "#FFF5F7" },
  responseIcon: { width: 37, height: 37, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#FCE8EE" },
  responseCopy: { flex: 1, marginLeft: 9 },
  responseTitle: { color: "#655159", fontSize: 11, fontWeight: "900" },
  responseDetail: { color: "#A38B93", fontSize: 8.5, marginTop: 2 },
  replyInput: { height: 44, marginTop: 8, borderRadius: 14, paddingHorizontal: 12, backgroundColor: "#FFF", borderWidth: 1, borderColor: "#EEDDE2", color: "#59494F", fontSize: 12 },
  completeGift: {
    marginTop: 19,
    minHeight: 150,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF0F4",
    borderWidth: 1,
    borderColor: "#F0CCD6",
  },
  completeTitle: { color: "#6A515A", fontSize: 15, fontWeight: "900", marginTop: 8 },
  completeText: { color: "#97727D", fontSize: 12, marginTop: 8, paddingHorizontal: 20, textAlign: "center" },
  completeHint: { color: "#A48D94", fontSize: 9, textAlign: "center", marginTop: 12 },
});
