// components/AlternativeCard.jsx
import { Sparkles } from "lucide-react-native";
import { Dimensions, Image, Text, TouchableOpacity, View } from "react-native";
import HardShadow from './HardShadow';

const { width } = Dimensions.get("window");
const CARD_WIDTH = width * 0.78;

const C = {
  bg:      "#ede8d8",
  surface: "#ffffff",
  border:  "#2a2a2a",
  blue:    "#2198a8",
  purple:  "#6b5390",
  dark:    "#2a2a2a",
  meta:    "#8a7850",
};

const SHADOW = {
  shadowColor: '#2a2a2a',
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 6,
};

export default function AlternativeCard({ item, onExplain, onCompare }) {
  const { name, manufacturer, price, savings, matchType, isDangerousClass } = item;
  const isPopular = matchType === "EXACT MATCH";

  return (
    <HardShadow style={{ width: CARD_WIDTH, marginRight: 14 }}>
    <View style={{ backgroundColor: C.bg, borderRadius: 4, padding: 18, borderWidth: 1.5, borderColor: C.border }}>

      {/* Top row: name + price badge */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={{ fontSize: 18, fontWeight: "900", color: C.dark, lineHeight: 22, marginBottom: 3 }} numberOfLines={2}>
            {name}
          </Text>
          <Text style={{ fontSize: 11, color: C.meta, lineHeight: 15 }} numberOfLines={1}>
            {manufacturer}
          </Text>
        </View>

        <View style={{ backgroundColor: C.purple, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, alignItems: "center", minWidth: 76 }}>
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "900" }}>{price}</Text>
          {savings ? (
            <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 9, fontWeight: "800", marginTop: 2 }}>{savings}</Text>
          ) : null}
        </View>
      </View>

      {/* Dangerous class warning */}
      {isDangerousClass && (
        <View style={{ backgroundColor: "#fff0f0", borderWidth: 1.5, borderColor: "#c0392b", borderRadius: 4, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 10 }}>
          <Text style={{ color: "#c0392b", fontSize: 10, fontWeight: "900", letterSpacing: 0.3 }}>
            ⚠ PRESCRIPTION REQUIRED — Do not switch without consulting your doctor
          </Text>
        </View>
      )}

      {/* Badges */}
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 12 }}>
        <View style={{ backgroundColor: isPopular ? C.blue : C.surface, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1.5, borderColor: C.border }}>
          <Text style={{ fontSize: 10, fontWeight: "900", color: isPopular ? "#fff" : C.dark }}>
            {isPopular ? "POPULAR PICK" : "THERAPEUTIC"}
          </Text>
        </View>
        <View style={{ backgroundColor: C.surface, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1.5, borderColor: C.border }}>
          <Text style={{ fontSize: 10, fontWeight: "900", color: C.dark }}>FAST DISSOLVE</Text>
        </View>
      </View>

      {/* Medicine image */}
      <Image
        source={{ uri: "https://images.unsplash.com/photo-1550572017-edd951b55104?w=400&auto=format&fit=crop&q=60" }}
        style={{ width: "100%", height: 120, borderRadius: 4, marginBottom: 14, borderWidth: 1.5, borderColor: C.border }}
        resizeMode="cover"
      />

      {/* Action buttons */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <HardShadow offset={2} style={{ flex: 1 }}>
          <TouchableOpacity
            onPress={onExplain}
            activeOpacity={0.75}
            style={{ backgroundColor: C.purple, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingVertical: 11, alignItems: "center" }}
          >
            <Text style={{ color: "#ffffff", fontWeight: "900", fontSize: 11, letterSpacing: 0.3 }}>VIEW DETAILS</Text>
          </TouchableOpacity>
        </HardShadow>
        <HardShadow offset={2} style={{ flex: 1 }}>
          <TouchableOpacity
            onPress={onCompare}
            activeOpacity={0.75}
            style={{ backgroundColor: C.blue, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, paddingVertical: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 }}
          >
            <Sparkles size={12} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 11, letterSpacing: 0.3 }}>COMPARE</Text>
          </TouchableOpacity>
        </HardShadow>
      </View>
    </View>
    </HardShadow>
  );
}
