// components/AlternativesCarousel.jsx
import { Lightbulb } from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";
import AlternativeCard from "./AlternativeCard";
import HardShadow from './HardShadow';

const C = {
  dark:    "#2a2a2a",
  blue:    "#2198a8",
  surface: "#ffffff",
  border:  "#2a2a2a",
};

const SHADOW = {
  shadowColor: '#2a2a2a',
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 6,
};

export default function AlternativesCarousel({ data, onSendMessage }) {
  if (!data) return null;
  const { targetMedicineName, description, alternatives, clinicalTip } = data;

  return (
    <HardShadow style={{ width: "100%", marginVertical: 10 }}>
    <View style={{ backgroundColor: "#ede8d8", borderRadius: 4, padding: 18, borderWidth: 1.5, borderColor: C.border }}>

      <Text style={{ fontSize: 20, fontWeight: "900", color: C.dark, lineHeight: 26, marginBottom: 4 }}>
        Alternatives to {targetMedicineName}
      </Text>
      {description ? (
        <Text style={{ fontSize: 13, color: "#666", lineHeight: 19, marginBottom: 14 }}>
          {description}
        </Text>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingRight: 8 }}
        style={{ marginBottom: 14 }}
      >
        {alternatives && alternatives.map((item, idx) => (
          <AlternativeCard
            key={idx}
            item={item}
            onExplain={() => onSendMessage?.("", { type: "card_explain", medicine: { id: item.name, name: item.name } })}
            onCompare={() => onSendMessage?.("", { type: "card_compare", clickedMedicine: { id: item.name, name: item.name } })}
          />
        ))}
      </ScrollView>

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
