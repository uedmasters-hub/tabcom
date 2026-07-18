import { Pressable, Text } from "react-native";
import { useRouter } from "expo-router";
import { startCall } from "@/lib/call-manager";

interface Props {
  peer: { username: string; name: string; color: string };
}

export function CallButton({ peer }: Props) {
  const router = useRouter();

  const handlePress = () => {
    startCall(peer);
    router.push(
      `/call/${peer.username}?peerName=${encodeURIComponent(peer.name)}&peerColor=${encodeURIComponent(peer.color)}&role=caller` as any
    );
  };

  return (
    <Pressable
      onPress={handlePress}
      className="px-3 py-1.5 bg-green-600/20 border border-green-900/30 rounded-lg active:opacity-70"
    >
      <Text className="text-green-400 text-xs font-semibold">📞 Call</Text>
    </Pressable>
  );
}
