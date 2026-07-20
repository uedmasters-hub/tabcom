import { Modal, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export type AttachmentAction =
  | "camera-photo"
  | "camera-video"
  | "library"
  | "document"
  | "location"
  | "contact";

interface Props {
  visible: boolean;
  onClose: () => void;
  onPick: (action: AttachmentAction) => void;
}

const ROWS: Array<{ id: AttachmentAction; icon: keyof typeof Ionicons.glyphMap; label: string }> = [
  { id: "camera-photo", icon: "camera-outline", label: "Camera" },
  { id: "camera-video", icon: "videocam-outline", label: "Record video" },
  { id: "library", icon: "images-outline", label: "Photo & Video Library" },
  { id: "document", icon: "document-outline", label: "Document" },
  { id: "location", icon: "location-outline", label: "Location" },
  { id: "contact", icon: "person-circle-outline", label: "Contact" },
];

/** Attachment action sheet — the "+" in the composer. Replaces the
 *  desktop Share-tab affordance with mobile-native capture options. */
export function AttachmentSheet({ visible, onClose, onPick }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/40 justify-end">
        <Pressable className="flex-1" onPress={onClose} />
        <View className="px-3 pb-3">
          <View className="bg-[#f2f2f7] rounded-2xl overflow-hidden mb-2">
            {ROWS.map((row, i) => (
              <Pressable
                key={row.id}
                onPress={() => { onClose(); setTimeout(() => onPick(row.id), 250); }}
                className={`flex-row items-center px-5 py-4 active:bg-slate-200 ${i > 0 ? "border-t border-slate-300/60" : ""}`}
              >
                <Ionicons name={row.icon} size={26} color="#2563eb" />
                <Text className="text-ink text-[19px] ml-5">{row.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={onClose} className="bg-white rounded-2xl py-4 items-center active:opacity-70">
            <Text className="text-primary text-[19px] font-semibold">Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
