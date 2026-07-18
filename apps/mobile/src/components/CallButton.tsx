import { Pressable, Text, Alert } from "react-native";
import { useRouter } from "expo-router";

interface Props { peer: { username: string; name: string; color: string }; }

export function CallButton({ peer }: Props) {
  const router = useRouter();
  const handlePress = () => {
    try {
      const { startCall } = require("@/lib/call-manager");
      startCall(peer);
      router.push(`/call/${peer.username}?peerName=${encodeURIComponent(peer.name)}&peerColor=${encodeURIComponent(peer.color)}&role=caller` as any);
    } catch {
      Alert.alert("Voice calls", "Calls require a development build. Run: npx expo prebuild && npx expo run:android");
    }
  };
  return (
    <Pressable onPress={handlePress} className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-xl active:opacity-70">
      <Text className="text-emerald-700 text-xs font-semibold">📞 Call</Text>
    </Pressable>
  );
}
