import { View, Image, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const W = 240;
const H = 130;
const Z = 15;
const TILE = 256;

/**
 * Static OSM map preview — mirrors the extension's location bubble so
 * both surfaces look the same.
 *
 * Tiles are fetched straight from tile.openstreetmap.org by the client
 * as the bubble renders; coordinates never touch Tabcom's servers.
 * A 2x2 grid toward the nearest edges guarantees full coverage
 * wherever the pin falls inside its tile. Attribution kept per OSM
 * policy.
 */
export function LocationPreview({ latitude, longitude }: { latitude: number; longitude: number }) {
  const n = 2 ** Z;
  const xF = ((longitude + 180) / 360) * n;
  const latR = (latitude * Math.PI) / 180;
  const yF = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  const x = Math.floor(xF);
  const y = Math.floor(yF);

  const xs = [x, xF - x < 0.5 ? x - 1 : x + 1];
  const ys = [y, yF - y < 0.5 ? y - 1 : y + 1];

  return (
    <View style={{ width: W, height: H }} className="bg-slate-200 overflow-hidden relative">
      {xs.flatMap((tx) =>
        ys.map((ty) => (
          <Image
            key={`${tx}-${ty}`}
            source={{ uri: `https://tile.openstreetmap.org/${Z}/${tx}/${ty}.png` }}
            style={{
              position: "absolute",
              width: TILE,
              height: TILE,
              left: W / 2 - (xF - tx) * TILE,
              top: H / 2 - (yF - ty) * TILE,
            }}
          />
        ))
      )}
      <View style={{ position: "absolute", left: W / 2 - 12, top: H / 2 - 24 }}>
        <Ionicons name="location" size={26} color="#dc2626" />
      </View>
      <Text
        className="absolute bottom-0 right-0 text-[8px] text-slate-600 bg-white/70 px-1"
      >
        © OpenStreetMap
      </Text>
    </View>
  );
}
