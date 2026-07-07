// components/AlternativesCarousel.jsx
import { ArrowLeftRight, ChevronRight, Lightbulb } from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";
import AlternativeCard, { CARD_WIDTH } from "./AlternativeCard";
import HardShadow from './HardShadow';

const C = {
  dark:    "#2a2a2a",
  blue:    "#2198a8",
  ochre:   "#9f9065",
  surface: "#ffffff",
  border:  "#2a2a2a",
  meta:    "#8a7850",
};

// Labeled horizontal snap row of AlternativeCards (used once per section).
function CardRow({ items, onSendMessage }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={CARD_WIDTH + 14}
      decelerationRate="fast"
      contentContainerStyle={{ paddingRight: 8 }}
      style={{ marginBottom: 14 }}
    >
      {items.map((item, idx) => (
        <AlternativeCard
          key={idx}
          item={item}
          onExplain={() => onSendMessage?.("", { type: "card_explain", medicine: { id: item.name, name: item.name } })}
          onCompare={() => onSendMessage?.("", { type: "card_compare", clickedMedicine: { id: item.name, name: item.name } })}
        />
      ))}
    </ScrollView>
  );
}

const SectionHeader = ({ color, children }) => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
    <View style={{ width: 4, height: 14, backgroundColor: color }} />
    <Text style={{ flex: 1, fontSize: 10, fontWeight: "800", color: C.meta, letterSpacing: 0.8, textTransform: "uppercase" }}>
      {children}
    </Text>
  </View>
);

export default function AlternativesCarousel({ data, onSendMessage }) {
  if (!data) return null;
  const { targetMedicineName, description, clinicalTip } = data;
  // New servers send sections; old payloads only have the flat `alternatives` array.
  const exact = data.exactSubstitutes ?? data.alternatives ?? [];
  const therapeutic = data.therapeuticAlternatives ?? [];
  const count = exact.length + therapeutic.length;

  return (
    <HardShadow style={{ width: "100%", marginVertical: 10 }}>
    <View style={{ backgroundColor: "#ede8d8", borderRadius: 4, padding: 18, borderWidth: 1.5, borderColor: C.border }}>

      {/* Header: ochre icon square (alternatives' accent everywhere in the app) + title */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 4 }}>
        <View style={{ width: 36, height: 36, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.ochre, alignItems: "center", justifyContent: "center" }}>
          <ArrowLeftRight size={17} color="#ffffff" strokeWidth={2.5} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 10, fontWeight: "800", color: C.meta, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 2 }}>
            Alternatives
          </Text>
          <Text style={{ fontSize: 18, fontWeight: "900", color: C.dark, lineHeight: 23 }}>
            {targetMedicineName}
          </Text>
        </View>
      </View>
      {description ? (
        <Text style={{ fontSize: 13, color: "#666", lineHeight: 19, marginTop: 6, marginBottom: 12 }}>
          {description}
        </Text>
      ) : <View style={{ height: 10 }} />}

      {/* Swipe hint — only when there's more than one card to reach */}
      {count > 1 && (
        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface }}>
            <Text style={{ fontSize: 9, fontWeight: "800", color: C.ochre, letterSpacing: 0.5 }}>
              {count} OPTIONS · SWIPE
            </Text>
            <ChevronRight size={10} color={C.ochre} strokeWidth={3} />
          </View>
        </View>
      )}

      {exact.length > 0 && (
        <View>
          <SectionHeader color={C.blue}>Exact substitutes · same ingredients</SectionHeader>
          <CardRow items={exact} onSendMessage={onSendMessage} />
        </View>
      )}

      {therapeutic.length > 0 && (
        <View>
          <SectionHeader color={C.ochre}>Therapeutic alternatives · different ingredients, same purpose · consult your doctor</SectionHeader>
          <CardRow items={therapeutic} onSendMessage={onSendMessage} />
        </View>
      )}

      {clinicalTip ? (
        <View style={{ flexDirection: "row", backgroundColor: C.surface, borderLeftWidth: 3, borderLeftColor: C.blue, borderRadius: 4, padding: 13, borderWidth: 1.5, borderColor: C.border, alignItems: "flex-start" }}>
          <Lightbulb size={18} color={C.blue} style={{ marginRight: 10, marginTop: 1, flexShrink: 0 }} />
          <Text style={{ flex: 1, fontSize: 13, color: C.dark, fontWeight: "600", lineHeight: 19 }}>
            {clinicalTip}
          </Text>
        </View>
      ) : null}
    </View>
    </HardShadow>
  );
}
