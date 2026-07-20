import { useEffect, useRef, useState } from "react";
import {
  Text, View, TextInput, Pressable, FlatList, Image, Linking,
  Platform, ActivityIndicator, Alert,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { Message } from "@tabcom/shared";
import { useChatStore } from "@/stores/chat";
import { AttachmentSheet, type AttachmentAction } from "./AttachmentSheet";
import { ContactPickerSheet } from "./ContactPickerSheet";
import { LocationPreview } from "./LocationPreview";
import { EmojiPicker } from "./EmojiPicker";
import { useVoiceRecorder, ensureMicPermission, packageRecording, MAX_VOICE_SECONDS } from "@/lib/voice";
import { captureWithCamera, pickFromLibrary, pickDocument, pickLocation } from "@/lib/media";

const ME = "me";

const presenceColor: Record<string, string> = {
  online: "#16a34a", away: "#eab308", busy: "#ef4444",
};

export interface ThreadPeer {
  title: string;
  subtitle?: string;
  color: string;
  presence?: string;
  /** DM only — enables call buttons. */
  username?: string;
}

interface Props {
  conversationId: string;
  peer: ThreadPeer;
  /** Community/group threads show a header action instead of calls. */
  onHeaderAction?: () => void;
  headerActionIcon?: keyof typeof Ionicons.glyphMap;
}

/**
 * ChatThread — the single thread implementation shared by DMs, groups
 * and community chats, so all three have identical layout, bubbles,
 * attachments, and behaviour. Header and composer are pinned; only the
 * message list scrolls.
 */
export function ChatThread({ conversationId, peer, onHeaderAction, headerActionIcon }: Props) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const recorder = useVoiceRecorder();
  const recStartedAt = useRef(0);
  const listRef = useRef<FlatList<Message>>(null);

  const messages = useChatStore((s) => s.messages[conversationId] ?? []);
  const typing = useChatStore((s) => s.typing);
  const contacts = useChatStore((s) => s.contacts);

  const isDm = !!peer.username;
  const contactId = peer.username ? `u-${peer.username}` : undefined;
  const isTyping = contactId ? typing.includes(contactId) : false;

  useEffect(() => {
    useChatStore.getState().openConversation(conversationId);
    return () => useChatStore.getState().closeConversation();
  }, [conversationId]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    useChatStore.getState().sendText(conversationId, t);
    setText("");
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
  };

  const handleAttachment = async (action: AttachmentAction) => {
    setBusy(true);
    try {
      const store = useChatStore.getState();
      if (action === "camera-photo" || action === "camera-video") {
        const media = await captureWithCamera(action === "camera-video" ? "video" : "photo");
        if (media) store.sendMedia(conversationId, media);
      } else if (action === "library") {
        const media = await pickFromLibrary();
        if (media) store.sendMedia(conversationId, media);
      } else if (action === "document") {
        const doc = await pickDocument();
        if (doc) store.sendMedia(conversationId, doc);
      } else if (action === "location") {
        const loc = await pickLocation();
        if (loc) store.sendMedia(conversationId, { kind: "location", ...loc });
      } else if (action === "contact") {
        setContactPickerOpen(true);
      }
    } finally {
      setBusy(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    }
  };

  // Press-and-hold to record; release to send. Auto-stops at the cap.
  useEffect(() => {
    if (!recording) return;
    const i = setInterval(() => {
      setRecSeconds((n) => {
        if (n + 1 >= MAX_VOICE_SECONDS) { void stopRecording(); return n; }
        return n + 1;
      });
    }, 1000);
    return () => clearInterval(i);
  }, [recording]);

  const startRecording = async () => {
    if (!(await ensureMicPermission())) return;
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      recStartedAt.current = Date.now();
      setRecSeconds(0);
      setRecording(true);
    } catch {
      setRecording(false);
    }
  };

  const stopRecording = async (cancel = false) => {
    if (!recording) return;
    setRecording(false);
    try {
      await recorder.stop();
      if (cancel) return;
      const uri = recorder.uri;
      if (!uri) return;
      const packaged = await packageRecording(uri, Date.now() - recStartedAt.current);
      if (packaged) {
        useChatStore.getState().sendMedia(conversationId, {
          kind: "voice",
          dataUrl: packaged.dataUrl,
          durationMs: packaged.durationMs,
          fileSize: packaged.fileSize,
          mimeType: "audio/m4a",
        });
      }
    } catch {
      /* recorder already torn down */
    }
  };

  const startCall = (video: boolean) => {
    if (!peer.username) return;
    try {
      const { startCall: begin } = require("@/lib/call-manager");
      begin({ username: peer.username, name: peer.title, color: peer.color }, video);
      router.push(
        `/call/${peer.username}?peerName=${encodeURIComponent(peer.title)}&peerColor=${encodeURIComponent(peer.color)}&role=caller&video=${video}` as any
      );
    } catch {
      router.push(`/call/${peer.username}?peerName=${encodeURIComponent(peer.title)}` as any);
    }
  };

  const onBubbleLongPress = (m: Message) => {
    if (m.deletedAt) return;
    const mine = m.authorId === ME;
    const options: any[] = [];
    if (m.kind === "text" && m.text) {
      options.push({ text: "Copy", onPress: () => Clipboard.setStringAsync(m.text ?? "") });
    }
    if (mine) {
      options.push({
        text: "Delete",
        style: "destructive",
        onPress: () => useChatStore.getState().deleteMessage(conversationId, m.id),
      });
    }
    if (options.length === 0) return;
    Alert.alert("Message", undefined, [...options, { text: "Cancel", style: "cancel" }]);
  };

  const Bubble = ({ m }: { m: Message }) => {
    const mine = m.authorId === ME;
    if (m.kind === "system") {
      return (
        <View className="px-10 py-2.5">
          <Text className="text-slate-400 text-[13px] text-center leading-5">{m.text}</Text>
        </View>
      );
    }

    const receipt = mine ? (
      m.status === "failed" ? (
        <Pressable onPress={() => useChatStore.getState().retryMessage(conversationId, m.id)}>
          <Text className="text-red-500 text-[12px] font-semibold">Retry</Text>
        </Pressable>
      ) : m.readAt ? (
        <Ionicons name="checkmark-done" size={16} color="#2563eb" />
      ) : m.status === "delivered" ? (
        <Ionicons name="checkmark-done" size={16} color="#94a3b8" />
      ) : (
        <Ionicons name="checkmark" size={16} color="#94a3b8" />
      )
    ) : null;

    const time = new Date(m.sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    return (
      <View className={`px-4 mb-3 ${mine ? "items-end" : "items-start"}`}>
        {!mine && m.authorName && (
          <Text style={{ color: m.authorColor ?? "#2563eb" }} className="text-[13px] font-semibold mb-1 ml-1">
            {m.authorName}
          </Text>
        )}
        <Pressable
          onLongPress={() => onBubbleLongPress(m)}
          delayLongPress={350}
          className={`max-w-[78%] overflow-hidden border ${
            mine
              ? "bg-slate-900 border-slate-900 rounded-3xl rounded-br-lg"
              : "bg-white border-slate-200 rounded-3xl rounded-bl-lg"
          }`}
        >
          {m.deletedAt ? (
            <Text className={`italic text-[15px] px-4 py-3 ${mine ? "text-slate-400" : "text-slate-400"}`}>
              Message deleted
            </Text>
          ) : m.kind === "image" && m.dataUrl ? (
            <Image source={{ uri: m.dataUrl }} style={{ width: 240, height: 240 }} resizeMode="cover" />
          ) : m.kind === "video" && m.dataUrl ? (
            <View style={{ width: 240, height: 160 }} className="bg-slate-800">
              {m.thumbnailUrl ? (
                <Image source={{ uri: m.thumbnailUrl }} style={{ width: 240, height: 160 }} resizeMode="cover" />
              ) : null}
              <View className="absolute inset-0 items-center justify-center">
                <View className="w-14 h-14 rounded-full bg-black/45 items-center justify-center">
                  <Ionicons name="play" size={28} color="#ffffff" style={{ marginLeft: 3 }} />
                </View>
              </View>
              <Text className="absolute bottom-2 right-2 text-white text-[11px] font-semibold bg-black/50 px-1.5 py-0.5 rounded">
                {m.fileSize ? `${(m.fileSize / 1024 / 1024).toFixed(1)} MB` : "Video"}
              </Text>
            </View>
          ) : m.kind === "file" ? (
            <View className="flex-row items-center px-4 py-3.5">
              <Ionicons name="document" size={26} color={mine ? "#93c5fd" : "#64748b"} />
              <View className="ml-3">
                <Text className={`text-[15px] font-semibold ${mine ? "text-white" : "text-ink"}`} numberOfLines={1}>
                  {m.fileName ?? "File"}
                </Text>
                {m.fileSize ? (
                  <Text className={mine ? "text-slate-400 text-xs" : "text-muted text-xs"}>
                    {(m.fileSize / 1024).toFixed(0)} KB
                  </Text>
                ) : null}
              </View>
            </View>
          ) : m.kind === "location" && m.latitude != null ? (
            <Pressable
              onPress={() => Linking.openURL(`https://maps.google.com/?q=${m.latitude},${m.longitude}`)}
            >
              <LocationPreview latitude={m.latitude} longitude={m.longitude!} />
              <View className="px-3.5 py-2.5">
                <Text className={`text-[14px] font-semibold ${mine ? "text-white" : "text-ink"}`}>
                  Shared location
                </Text>
                <Text className={`text-[12px] mt-0.5 ${mine ? "text-slate-400" : "text-muted"}`}>
                  {m.latitude.toFixed(5)}, {m.longitude?.toFixed(5)} — open in Maps
                </Text>
              </View>
            </Pressable>
          ) : m.kind === "contact" ? (
            <View className="flex-row items-center px-4 py-3.5">
              <View style={{ backgroundColor: m.contactColor ?? "#2563eb" }} className="w-10 h-10 rounded-full items-center justify-center">
                <Text className="text-white font-bold">{(m.contactName ?? "?").slice(0, 1).toUpperCase()}</Text>
              </View>
              <View className="ml-3">
                <Text className={`text-[15px] font-semibold ${mine ? "text-white" : "text-ink"}`}>{m.contactName}</Text>
                <Text className={mine ? "text-slate-400 text-xs" : "text-muted text-xs"}>@{m.contactUsername}</Text>
              </View>
            </View>
          ) : m.kind === "voice" ? (
            <View className="flex-row items-center px-4 py-3.5">
              <Ionicons name="mic" size={22} color={mine ? "#93c5fd" : "#16a34a"} />
              <Text className={`ml-2 text-[15px] ${mine ? "text-white" : "text-ink"}`}>
                {m.durationMs ? `${Math.floor(m.durationMs / 60000)}:${String(Math.floor((m.durationMs % 60000) / 1000)).padStart(2, "0")}` : "Voice"}
              </Text>
            </View>
          ) : (
            <Text className={`text-[16.5px] leading-[23px] px-4 py-3 ${mine ? "text-white" : "text-ink"}`}>
              {m.text}
            </Text>
          )}
        </Pressable>
        <View className={`flex-row items-center gap-1.5 mt-1 ${mine ? "mr-1" : "ml-1"}`}>
          {mine && receipt}
          <Text className="text-slate-400 text-[12.5px]">{time}</Text>
          {m.editedAt && <Text className="text-slate-400 text-[11px]">edited</Text>}
        </View>
        {m.reactions && m.reactions.length > 0 && (
          <View className={`flex-row gap-1.5 mt-1 ${mine ? "mr-1" : "ml-1"}`}>
            {m.reactions.map((r) => (
              <View key={r.emoji} className="bg-white border border-slate-200 rounded-full px-2.5 py-1 flex-row items-center">
                <Text className="text-sm">{r.emoji}</Text>
                <Text className="text-muted text-xs ml-1 font-semibold">{r.usernames.length}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      {/* Pinned header */}
      <View className="flex-row items-center px-4 py-3 bg-background">
        <Pressable onPress={() => router.back()} hitSlop={8} className="pr-2 active:opacity-50">
          <Ionicons name="chevron-back" size={30} color="#2563eb" />
        </Pressable>
        <View className="relative mr-3">
          <View style={{ backgroundColor: peer.color }} className="w-11 h-11 rounded-full items-center justify-center">
            <Text className="text-white font-bold text-base">{peer.title.slice(0, 1).toUpperCase()}</Text>
          </View>
          {peer.presence && presenceColor[peer.presence] && (
            <View style={{ backgroundColor: presenceColor[peer.presence] }} className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white" />
          )}
        </View>
        <View className="flex-1">
          <Text className="text-ink font-bold text-[21px]" numberOfLines={1}>{peer.title}</Text>
          {isTyping ? (
            <Text className="text-primary text-[13px]">typing…</Text>
          ) : peer.subtitle ? (
            <Text className="text-muted text-[13px]" numberOfLines={1}>{peer.subtitle}</Text>
          ) : null}
        </View>

        {isDm ? (
          <View className="flex-row items-center bg-surface rounded-full px-1.5 py-1.5">
            <Pressable onPress={() => startCall(true)} className="px-3 active:opacity-60">
              <Ionicons name="videocam-outline" size={25} color="#334155" />
            </Pressable>
            <View className="w-px h-6 bg-slate-300" />
            <Pressable onPress={() => startCall(false)} className="px-3 active:opacity-60">
              <Ionicons name="call-outline" size={23} color="#334155" />
            </Pressable>
          </View>
        ) : onHeaderAction ? (
          <Pressable onPress={onHeaderAction} className="w-11 h-11 rounded-full bg-surface items-center justify-center active:opacity-60">
            <Ionicons name={headerActionIcon ?? "information-circle-outline"} size={23} color="#334155" />
          </Pressable>
        ) : null}
      </View>

      {/* Scrollable body */}
      <KeyboardAvoidingView behavior="padding" className="flex-1 bg-[#eef0f2]">
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <Bubble m={item} />}
          contentContainerStyle={{ paddingVertical: 14 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          className="flex-1"
        />

        {/* Pinned composer — swaps to a recording bar while recording */}
        {recording ? (
          <View className="flex-row items-center px-4 py-3 bg-background border-t border-slate-100">
            <Pressable
              onPress={() => stopRecording(true)}
              hitSlop={10}
              className="w-11 h-11 rounded-full bg-surface items-center justify-center active:opacity-60"
            >
              <Ionicons name="trash-outline" size={21} color="#dc2626" />
            </Pressable>
            <View className="flex-1 flex-row items-center bg-red-50 rounded-full px-4 py-3 mx-2.5">
              <View className="w-2.5 h-2.5 rounded-full bg-red-500 mr-2.5" />
              <Text className="text-red-600 font-bold text-[16px] flex-1">
                {String(Math.floor(recSeconds / 60)).padStart(2, "0")}:{String(recSeconds % 60).padStart(2, "0")}
              </Text>
              <Text className="text-red-400 text-[13px]">recording…</Text>
            </View>
            <Pressable
              onPress={() => stopRecording(false)}
              className="w-11 h-11 rounded-full bg-primary items-center justify-center active:opacity-80"
            >
              <Ionicons name="send" size={18} color="#fff" style={{ marginLeft: -2 }} />
            </Pressable>
          </View>
        ) : (
        <View className="flex-row items-center px-3 py-2.5 bg-background border-t border-slate-100">
          <Pressable onPress={() => setSheetOpen(true)} hitSlop={8} className="px-2 active:opacity-50">
            {busy ? <ActivityIndicator size="small" color="#64748b" /> : <Ionicons name="add" size={30} color="#334155" />}
          </Pressable>

          <View className="flex-1 flex-row items-center bg-surface rounded-full px-3.5 mx-1">
            <Pressable onPress={() => setEmojiOpen((v) => !v)} hitSlop={8} className="active:opacity-50">
              <Ionicons name={emojiOpen ? "happy" : "happy-outline"} size={23} color={emojiOpen ? "#2563eb" : "#94a3b8"} />
            </Pressable>
            <TextInput
              value={text}
              onChangeText={(v) => {
                setText(v);
                if (peer.username) useChatStore.getState().emitTyping(peer.username);
              }}
              placeholder={`Message ${peer.title}...`}
              placeholderTextColor="#94a3b8"
              multiline
              returnKeyType="send"
              blurOnSubmit={false}
              onSubmitEditing={send}
              submitBehavior="submit"
              className="flex-1 py-3 px-2.5 text-ink text-[16.5px] max-h-24"
            />
            <Pressable onPress={startRecording} hitSlop={10} className="active:opacity-50">
              <Ionicons name="mic-outline" size={23} color="#94a3b8" />
            </Pressable>
          </View>

          <Pressable
            onPress={send}
            disabled={!text.trim()}
            className={`w-11 h-11 rounded-full items-center justify-center ${text.trim() ? "bg-primary" : "bg-slate-200"}`}
          >
            <Ionicons name="send" size={19} color={text.trim() ? "#ffffff" : "#94a3b8"} style={{ marginLeft: -2 }} />
          </Pressable>
        </View>
        )}

        {emojiOpen && (
          <EmojiPicker onSelect={(e) => setText((t) => t + e)} />
        )}
      </KeyboardAvoidingView>

      <AttachmentSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} onPick={handleAttachment} />
      <ContactPickerSheet
        visible={contactPickerOpen}
        onClose={() => setContactPickerOpen(false)}
        onSelect={(c) => {
          setContactPickerOpen(false);
          useChatStore.getState().sendMedia(conversationId, {
            kind: "contact",
            contactUsername: c.username,
            contactName: c.name,
            contactColor: c.color,
          });
        }}
      />
    </SafeAreaView>
  );
}
