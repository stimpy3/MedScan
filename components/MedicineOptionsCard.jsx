// components/MedicineOptionsCard.jsx
import { Text, TouchableOpacity, View } from "react-native";
import HardShadow from './HardShadow';

const SHADOW = {
  shadowColor: '#2a2a2a',
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 6,
};

export default function MedicineOptionsCard({ question, options, onSelect }) {
  if (!options || options.length === 0) return null;

  return (
    <HardShadow style={{ width: "100%", marginVertical: 10 }}>
    <View style={{
      backgroundColor: "#ede8d8",
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: "#2a2a2a",
      overflow: "hidden",
    }}>
      {question && (
        <>
          <View style={{ paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#ffffff" }}>
            <Text style={{ fontSize: 14, fontWeight: "800", color: "#2a2a2a", lineHeight: 20 }}>
              {question}
            </Text>
          </View>
          <View style={{ height: 1, backgroundColor: "#2a2a2a" }} />
        </>
      )}

      {options.map((option, idx) => (
        <View key={idx}>
          <TouchableOpacity
            onPress={() => onSelect(option.name)}
            activeOpacity={0.6}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 14,
              backgroundColor: idx % 2 === 0 ? "#ffffff" : "#ffffff",
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: "800", color: "#2198a8" }}>
              {option.name}
            </Text>
          </TouchableOpacity>
          {idx < options.length - 1 && (
            <View style={{ height: 1.5, backgroundColor: "rgba(42,42,42,0.2)", marginHorizontal: 16 }} />
          )}
        </View>
      ))}
    </View>
    </HardShadow>
  );
}
