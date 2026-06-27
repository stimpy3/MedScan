// components/CompareClarifyCard.jsx
// Side-by-side dual clarification for the compare flow. Shown when BOTH medicine references in a
// message are ambiguous. The user picks one option per column, then taps Compare (disabled until
// both sides are chosen), which fires a `compare_pick` action resolved by id on the server.
import { useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import HardShadow from "./HardShadow";

const C = {
  bg:      "#ede8d8",
  surface: "#ffffff",
  border:  "#2a2a2a",
  blue:    "#2198a8",
  purple:  "#6b5390",
  dark:    "#2a2a2a",
  meta:    "#8a7850",
};

function Column({ slot, accent, selected, onPick }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 10, fontWeight: "900", color: C.meta, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }} numberOfLines={1}>
        {slot.query}
      </Text>
      <View style={{ gap: 8 }}>
        {slot.options.map((opt) => {
          const on = selected?.id === opt.id;
          return (
            <TouchableOpacity
              key={opt.id}
              activeOpacity={0.75}
              onPress={() => onPick(opt)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 10,
                borderRadius: 4,
                borderWidth: 1.5,
                borderColor: C.border,
                backgroundColor: on ? accent : C.surface,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: "800", color: on ? "#ffffff" : C.dark }}>
                {opt.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function CompareClarifyCard({ data, onSelect }) {
  const [selA, setSelA] = useState(null);
  const [selB, setSelB] = useState(null);

  if (!data || !data.a || !data.b) return null;
  const ready = selA && selB;

  const handleCompare = () => {
    if (!ready) return;
    onSelect?.("", {
      type: "compare_pick",
      a: { id: selA.id, name: selA.name },
      b: { id: selB.id, name: selB.name },
    });
  };

  return (
    <HardShadow style={{ width: "100%", marginVertical: 10 }}>
      <View style={{ backgroundColor: C.bg, borderRadius: 4, padding: 18, borderWidth: 1.5, borderColor: C.border }}>
        <Text style={{ fontSize: 14, fontWeight: "900", color: C.dark, marginBottom: 14 }}>
          Pick one from each side to compare
        </Text>

        <View style={{ flexDirection: "row", gap: 12, marginBottom: 16 }}>
          <Column slot={data.a} accent={C.blue} selected={selA} onPick={setSelA} />
          <View style={{ width: 1.5, backgroundColor: C.border }} />
          <Column slot={data.b} accent={C.purple} selected={selB} onPick={setSelB} />
        </View>

        <HardShadow offset={ready ? 2 : 0}>
          <TouchableOpacity
            activeOpacity={ready ? 0.85 : 1}
            onPress={handleCompare}
            disabled={!ready}
            style={{
              backgroundColor: ready ? C.blue : "#cdc6b4",
              borderRadius: 4,
              borderWidth: 1.5,
              borderColor: C.border,
              paddingVertical: 13,
              alignItems: "center",
              opacity: ready ? 1 : 0.7,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: "900", color: "#ffffff", letterSpacing: 0.5 }}>
              {ready ? "COMPARE" : "SELECT BOTH TO COMPARE"}
            </Text>
          </TouchableOpacity>
        </HardShadow>
      </View>
    </HardShadow>
  );
}
