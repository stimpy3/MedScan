// components/AlternativeCard.jsx
// One alternative medicine inside the AlternativesCarousel. White card on the carousel's beige
// body; accent color keys off the match type (blue = exact match, ochre = therapeutic).
import { Pill, Sparkles } from "lucide-react-native";
import { Dimensions, Text, TouchableOpacity, View } from "react-native";
import HardShadow from './HardShadow';

const { width } = Dimensions.get("window");
export const CARD_WIDTH = width * 0.78;

const C = {
  bg:      "#ede8d8",
  surface: "#ffffff",
  border:  "#2a2a2a",
  blue:    "#2198a8",
  purple:  "#6b5390",
  ochre:   "#9f9065",
  dark:    "#2a2a2a",
  meta:    "#8a7850",
  green:   "#065f46",
  greenBg: "#d1fae5",
};

export default function AlternativeCard({ item, onExplain, onCompare }) {
  const { name, manufacturer, price, savings, matchType, isDangerousClass, whySuggested, className, consultDoctor } = item;
  const isExact = matchType === "EXACT MATCH";
  const accent = isExact ? C.blue : C.ochre;

  return (
    <HardShadow style={{ width: CARD_WIDTH, marginRight: 14 }}>
    <View style={{ backgroundColor: C.surface, borderRadius: 4, padding: 16, borderWidth: 1.5, borderColor: C.border }}>

      {/* Top row: icon square + name/manufacturer + price box */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
        <View style={{ width: 38, height: 38, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: accent, alignItems: "center", justifyContent: "center" }}>
          <Pill size={18} color="#ffffff" strokeWidth={2.5} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: "900", color: C.dark, lineHeight: 21, marginBottom: 3 }} numberOfLines={2}>
            {name}
          </Text>
          <Text style={{ fontSize: 11, fontWeight: "600", color: C.meta, lineHeight: 15 }} numberOfLines={1}>
            {manufacturer}
          </Text>
        </View>
        <View style={{ backgroundColor: C.purple, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, alignItems: "center", minWidth: 72 }}>
          <Text style={{ fontSize: 9, fontWeight: "800", color: "rgba(255,255,255,0.8)", letterSpacing: 1 }}>PRICE</Text>
          <Text style={{ color: "#fff", fontSize: 13, fontWeight: "900", marginTop: 1 }}>{price}</Text>
        </View>
      </View>

      {/* Consult-doctor / prescription warnings (merged when both apply) */}
      {(isDangerousClass || consultDoctor) && (
        <View style={{ backgroundColor: "#ffe0e0", borderWidth: 1.5, borderColor: "#e53e3e", borderRadius: 4, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 12 }}>
          <Text style={{ color: "#c0392b", fontSize: 10, fontWeight: "900", letterSpacing: 0.3 }}>
            {consultDoctor
              ? "⚠ DIFFERENT INGREDIENT — confirm with your doctor before switching"
              : "⚠ PRESCRIPTION REQUIRED — Do not switch without consulting your doctor"}
          </Text>
          {consultDoctor && isDangerousClass ? (
            <Text style={{ color: "#c0392b", fontSize: 10, fontWeight: "900", letterSpacing: 0.3, marginTop: 3 }}>
              ⚠ PRESCRIPTION REQUIRED
            </Text>
          ) : null}
        </View>
      )}

      {/* Match + class + savings badges */}
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <View style={{ backgroundColor: accent, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 4, borderWidth: 1.5, borderColor: C.border }}>
          <Text style={{ fontSize: 10, fontWeight: "900", color: "#fff", letterSpacing: 0.3 }}>
            {matchType || "THERAPEUTIC MATCH"}
          </Text>
        </View>
        {className ? (
          <View style={{ backgroundColor: C.surface, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 4, borderWidth: 1.5, borderColor: C.border }}>
            <Text style={{ fontSize: 10, fontWeight: "900", color: C.dark, letterSpacing: 0.3 }} numberOfLines={1}>{className}</Text>
          </View>
        ) : null}
        {savings ? (
          <View style={{ backgroundColor: C.greenBg, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 4, borderWidth: 1.5, borderColor: C.border }}>
            <Text style={{ fontSize: 10, fontWeight: "900", color: C.green, letterSpacing: 0.3 }}>{savings}</Text>
          </View>
        ) : null}
      </View>

      {/* Why suggested — deterministic server-side reason */}
      {whySuggested ? (
        <Text style={{ fontSize: 11, fontWeight: "600", color: C.meta, lineHeight: 16, marginBottom: 12 }}>
          {whySuggested}
        </Text>
      ) : <View style={{ height: 4 }} />}

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
