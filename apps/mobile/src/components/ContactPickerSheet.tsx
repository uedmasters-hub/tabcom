import { Modal, Pressable, Text, View, FlatList } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useChatStore } from "@/stores/chat";
import { useAuth } from "@/stores/auth";
import type { Contact } from "@tabcom/shared";

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (contact: Contact) => void;
}

/** Pick WHICH contact to share. Previously the composer grabbed the
 *  first entry in the roster, which was usually the wrong person (and
 *  often you). */
export function ContactPickerSheet({ visible, onClose, onSelect }: Props) {
  const contacts = useChatStore((s) => s.contacts);
  const connections = useChatStore((s) => s.connections);
  const me = useAuth((s) => s.user);

  const shareable = contacts.filter(
    (c) =>
      c.id.startsWith("u-") &&
      c.username !== me?.username &&
      connections[c.username] === "accepted"
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/40 justify-end">
        <Pressable className="flex-1" onPress={onClose} />
        <View className="bg-white rounded-t-3xl max-h-[70%]">
          <View className="flex-row items-center px-5 py-4 border-b border-slate-100">
            <Text className="flex-1 text-ink font-bold text-[19px]">Share a contact</Text>
            <Pressable onPress={onClose} hitSlop={10} className="active:opacity-60">
              <Ionicons name="close" size={24} color="#64748b" />
            </Pressable>
          </View>

          {shareable.length === 0 ? (
            <View className="items-center py-14 px-8">
              <Ionicons name="people-outline" size={44} color="#cbd5e1" />
              <Text className="text-ink font-semibold text-base mt-3">No contacts to share</Text>
              <Text className="text-muted text-center text-[15px] mt-1">
                Only accepted connections can be shared.
              </Text>
            </View>
          ) : (
            <FlatList
              data={shareable}
              keyExtractor={(c) => c.id}
              contentContainerStyle={{ paddingBottom: 28 }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => onSelect(item)}
                  className="flex-row items-center px-5 py-3.5 active:bg-surface"
                >
                  <View style={{ backgroundColor: item.color }} className="w-12 h-12 rounded-full items-center justify-center mr-4">
                    <Text className="text-white font-bold text-lg">
                      {(item.alias ?? item.name).slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-ink font-semibold text-[17px]">{item.alias ?? item.name}</Text>
                    <Text className="text-muted text-[14px]">@{item.username}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#cbd5e1" />
                </Pressable>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}
