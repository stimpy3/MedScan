// components/ComparisonCard.jsx
import { Check, Lightbulb } from "lucide-react-native";
import { Text, View } from "react-native";
import HardShadow from './HardShadow';

const C = {
  bg:      "#ede8d8",
  surface: "#ffffff",
  border:  "#2a2a2a",
  blue:    "#2198a8",
  purple:  "#6b5390",
  ochre:   "#9f9065",
  dark:    "#2a2a2a",
  body:    "#444444",
  meta:    "#8a7850",
  green:   "#065f46",
  greenBg: "#d1fae5",
};

const SHADOW = {
  shadowColor: '#2a2a2a',
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 6,
};

function MedColumn({ med, isCheaper, priceDeltaPct, align }) {
  const accent = align === "left" ? C.blue : C.purple;
  return (
    <View style={{ flex: 1, alignItems: align === "left" ? "flex-start" : "flex-end" }}>
      <Text
        style={{ fontSize: 14, fontWeight: "900", color: C.dark, lineHeight: 19, marginBottom: 6, textAlign: align === "left" ? "left" : "right" }}
        numberOfLines={3}
      >
        {med.name}
      </Text>

      <View style={{ backgroundColor: accent, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 4, marginBottom: 8, borderWidth: 1.5, borderColor: C.border, alignSelf: align === "left" ? "flex-start" : "flex-end" }}>
        <Text style={{ fontSize: 10, fontWeight: "800", color: "#fff" }}>{med.type || "Allopathy"}</Text>
      </View>

      <Text style={{ fontSize: 15, fontWeight: "900", color: accent }}>
        {med.price}
      </Text>

      {isCheaper && priceDeltaPct ? (
        <View style={{ backgroundColor: C.greenBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, marginTop: 5, borderWidth: 1.5, borderColor: C.border, alignSelf: align === "left" ? "flex-start" : "flex-end" }}>
          <Text style={{ fontSize: 9, fontWeight: "900", color: C.green }}>BEST PRICE · -{priceDeltaPct}%</Text>
        </View>
      ) : null}
    </View>
  );
}

function DiffRow({ row, zebra }) {
  return (
    <View style={{ borderRadius: 4, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border, marginBottom: 8, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, gap: 8 }}>
        <View style={{ width: 4, height: 14, backgroundColor: C.blue }} />
        <Text style={{ fontSize: 11, fontWeight: "800", color: C.dark, letterSpacing: 0.3, textTransform: "uppercase" }}>
          {row.label}
        </Text>
      </View>
      <View style={{ height: 1, backgroundColor: C.border }} />
      <View style={{ flexDirection: "row" }}>
        <Text style={{ flex: 1, fontSize: 12, color: C.body, lineHeight: 18, padding: 12, textAlign: "left" }}>{row.a || "—"}</Text>
        <View style={{ width: 2, backgroundColor: C.border }} />
        <Text style={{ flex: 1, fontSize: 12, color: C.body, lineHeight: 18, padding: 12, textAlign: "right" }}>{row.b || "—"}</Text>
      </View>
    </View>
  );
}

export default function ComparisonCard({ data }) {
  if (!data || !Array.isArray(data.medicines) || data.medicines.length < 2) return null;

  const { medicines, cheaper, priceDeltaPct, differences = [], similarities = [], verdict } = data;
  const [a, b] = medicines;

  return (
    <HardShadow style={{ width: "100%", marginVertical: 10 }}>
    <View style={{ backgroundColor: C.bg, borderRadius: 4, padding: 20, borderWidth: 1.5, borderColor: C.border }}>

      <Text style={{ fontSize: 10, fontWeight: "800", color: C.meta, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 14, textAlign: "center" }}>
        Side-by-side comparison
      </Text>

      {/* VS Header strip */}
      <View style={{ backgroundColor: C.surface, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, paddingVertical: 16, paddingHorizontal: 14, flexDirection: "row", alignItems: "flex-start", marginBottom: 18 }}>
        <MedColumn med={a} isCheaper={cheaper === "A"} priceDeltaPct={priceDeltaPct} align="left" />

        <View style={{ alignItems: "center", justifyContent: "center", paddingHorizontal: 10, paddingTop: 4 }}>
          <Text style={{ color: C.ochre, fontSize: 22, fontWeight: "900", letterSpacing: 0.5 }}>VS</Text>
        </View>

        <MedColumn med={b} isCheaper={cheaper === "B"} priceDeltaPct={priceDeltaPct} align="right" />
      </View>

      {differences.length > 0 ? (
        <>
          <View style={{ flexDirection: "row", marginBottom: 6, paddingHorizontal: 2 }}>
            <View style={{ flex: 1 }}>
              <View style={{ backgroundColor: C.blue, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, alignSelf: "flex-start" }}>
                <Text style={{ fontSize: 9, fontWeight: "900", color: "#fff" }} numberOfLines={1}>
                  {a.name.split(" ").slice(0, 2).join(" ").toUpperCase()}
                </Text>
              </View>
            </View>
            <View style={{ flex: 1, alignItems: "flex-end" }}>
              <View style={{ backgroundColor: C.purple, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, alignSelf: "flex-end" }}>
                <Text style={{ fontSize: 9, fontWeight: "900", color: "#fff" }} numberOfLines={1}>
                  {b.name.split(" ").slice(0, 2).join(" ").toUpperCase()}
                </Text>
              </View>
            </View>
          </View>

          <Text style={{ fontSize: 13, fontWeight: "900", color: C.dark, marginBottom: 10 }}>Key Differences</Text>
          {differences.map((row, idx) => (
            <DiffRow key={idx} row={row} zebra={idx % 2 === 0} />
          ))}
        </>
      ) : null}

      {similarities.length > 0 ? (
        <View style={{ marginTop: 6 }}>
          <Text style={{ fontSize: 13, fontWeight: "900", color: C.dark, marginBottom: 10 }}>What They Share</Text>
          <View style={{ backgroundColor: C.surface, borderRadius: 4, padding: 14, borderWidth: 1.5, borderColor: C.border }}>
            {similarities.map((sim, idx) => (
              <View key={idx} style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: idx === similarities.length - 1 ? 0 : 10 }}>
                <View style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: C.blue, borderWidth: 1.5, borderColor: C.border, alignItems: "center", justifyContent: "center", marginRight: 10, marginTop: 1, flexShrink: 0 }}>
                  <Check size={12} color="#fff" strokeWidth={3} />
                </View>
                <Text style={{ flex: 1, fontSize: 13, color: C.dark, fontWeight: "600", lineHeight: 19 }}>{sim}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {verdict ? (
        <View style={{ flexDirection: "row", backgroundColor: C.surface, borderLeftWidth: 3, borderLeftColor: C.blue, borderRadius: 4, padding: 13, marginTop: 14, alignItems: "flex-start", borderWidth: 1.5, borderColor: C.border }}>
          <Lightbulb size={18} color={C.blue} style={{ marginRight: 10, marginTop: 1, flexShrink: 0 }} />
          <Text style={{ flex: 1, fontSize: 13, color: C.dark, fontWeight: "600", lineHeight: 19 }}>{verdict}</Text>
        </View>
      ) : null}
    </View>
    </HardShadow>
  );
}
