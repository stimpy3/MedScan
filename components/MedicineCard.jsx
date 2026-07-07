// components/MedicineCard.jsx
import { ChevronDown, ChevronUp, FileText, Globe } from "lucide-react-native";
import { useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import HardShadow from './HardShadow';
import SafetyWarnings from './SafetyWarnings';

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
};

const SHADOW = {
  shadowColor: '#2a2a2a',
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 6,
};

export default function MedicineCard({ data, onSendMessage }) {
  const [expandedSection, setExpandedSection] = useState("overview");
  if (!data) return null;

  const { name, type = "Allopathy", category = "Medication", short_desc, price, pack_size, overview, composition, side_effects, manufacturer, therapeuticClass, sources, safety } = data;

  const toggle = (id) => setExpandedSection(prev => (prev === id ? null : id));

  const AccordionItem = ({ id, title, content }) => {
    if (!content) return null;
    const open = expandedSection === id;
    return (
      <View style={{ borderRadius: 4, backgroundColor: C.surface, marginBottom: 8, overflow: "hidden", borderWidth: 1.5, borderColor: C.border, ...(open ? { shadowColor: '#2a2a2a', shadowOffset: { width: 2, height: 2 }, shadowOpacity: 1, shadowRadius: 0, elevation: 3 } : {}) }}>
        <TouchableOpacity
          onPress={() => toggle(id)}
          activeOpacity={0.7}
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 4, height: 16, backgroundColor: open ? C.blue : "#d8d0bc" }} />
            <Text style={{ fontSize: 13, fontWeight: "800", color: open ? C.dark : C.meta }}>{title}</Text>
          </View>
          {open ? <ChevronUp size={16} color={C.blue} strokeWidth={2.5} /> : <ChevronDown size={16} color={C.meta} strokeWidth={2.5} />}
        </TouchableOpacity>
        {open && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 14, paddingTop: 2 }}>
            <Text style={{ fontSize: 13, color: C.body, lineHeight: 20 }}>{content}</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <HardShadow style={{ width: "100%", marginVertical: 10 }}>
    <View style={{ backgroundColor: C.bg, borderRadius: 4, padding: 20, borderWidth: 1.5, borderColor: C.border }}>

      {/* Micro-label: dark icon square — "explain" is dark everywhere in the app */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <View style={{ width: 28, height: 28, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.dark, alignItems: "center", justifyContent: "center" }}>
          <FileText size={14} color="#ffffff" strokeWidth={2.5} />
        </View>
        <Text style={{ fontSize: 10, fontWeight: "800", color: C.meta, letterSpacing: 1.2, textTransform: "uppercase" }}>
          Medicine explained
        </Text>
      </View>

      {/* Header row */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ fontSize: 22, fontWeight: "900", color: C.dark, lineHeight: 28, marginBottom: 8 }}>{name}</Text>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            <View style={{ backgroundColor: C.blue, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, borderWidth: 1.5, borderColor: C.border }}>
              <Text style={{ fontSize: 11, fontWeight: "800", color: "#ffffff" }}>{type}</Text>
            </View>
            <View style={{ backgroundColor: C.surface, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, borderWidth: 1.5, borderColor: C.border }}>
              <Text style={{ fontSize: 11, fontWeight: "800", color: C.dark }}>{category}</Text>
            </View>
            {therapeuticClass?.label ? (
              <View style={{ backgroundColor: C.ochre, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, borderWidth: 1.5, borderColor: C.border }}>
                <Text style={{ fontSize: 11, fontWeight: "800", color: "#ffffff" }}>{therapeuticClass.label}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Price box */}
        <View style={{ backgroundColor: C.purple, padding: 12, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, alignItems: "center", minWidth: 72 }}>
          <Text style={{ fontSize: 10, fontWeight: "800", color: "rgba(255,255,255,0.8)", letterSpacing: 1, textTransform: "uppercase" }}>PRICE</Text>
          <Text style={{ fontSize: 16, fontWeight: "900", color: "#ffffff", marginTop: 2 }}>{price}</Text>
        </View>
      </View>

      {short_desc ? (
        <Text style={{ fontSize: 13, color: C.body, lineHeight: 19, marginBottom: 14 }}>{short_desc}</Text>
      ) : null}

      {/* Commonly used for — deterministic ATC-class bullets, no LLM involved */}
      {therapeuticClass?.commonUses?.length ? (
        <View style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 10, fontWeight: "800", color: C.meta, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>
            COMMONLY USED FOR
          </Text>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {therapeuticClass.commonUses.map((use, i) => (
              <View key={i} style={{ backgroundColor: C.surface, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4, borderWidth: 1.5, borderColor: C.border }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: C.dark }}>{use}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ height: 1, backgroundColor: C.border, marginBottom: 14 }} />

      {/* Packaging strip */}
      <View style={{ backgroundColor: C.surface, borderRadius: 4, padding: 14, marginBottom: 14, borderWidth: 1.5, borderColor: C.border }}>
        <Text style={{ fontSize: 10, fontWeight: "800", color: C.meta, letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>PACKAGING</Text>
        <Text style={{ fontSize: 13, fontWeight: "800", color: C.dark }}>{pack_size || "Standard"}</Text>
      </View>

      <SafetyWarnings safety={safety} />

      <AccordionItem id="overview"     title="Overview"      content={overview} />
      <AccordionItem id="composition"  title="Composition"   content={composition} />
      <AccordionItem id="side_effects" title="Side Effects"  content={side_effects} />
      <AccordionItem id="manufacturer" title="Manufacturer"  content={manufacturer} />

      {/* Others in this class — same-class, different-ingredient examples; tap to explain */}
      {therapeuticClass?.sameClassExamples?.length ? (
        <View style={{ backgroundColor: C.surface, borderRadius: 4, padding: 14, marginTop: 6, borderWidth: 1.5, borderColor: C.border }}>
          <Text style={{ fontSize: 10, fontWeight: "800", color: C.meta, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
            OTHERS IN THIS CLASS · DIFFERENT INGREDIENT
          </Text>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {therapeuticClass.sameClassExamples.map((ex, i) => (
              <TouchableOpacity
                key={i}
                activeOpacity={0.8}
                disabled={!onSendMessage}
                onPress={() => onSendMessage?.("", { type: "card_explain", medicine: { id: ex.name, name: ex.name } })}
                style={{ backgroundColor: C.bg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4, borderWidth: 1.5, borderColor: C.border }}
              >
                <Text style={{ fontSize: 11, fontWeight: "800", color: C.dark }}>
                  {ex.name}{ex.price ? ` · ${ex.price}` : ""}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={{ fontSize: 10, fontWeight: "600", color: C.meta, marginTop: 8 }}>
            Same therapeutic class, different ingredient — not automatic substitutes. Consult your doctor.
          </Text>
        </View>
      ) : null}

      {/* Transparency note: shown only when missing data was filled from the web */}
      {Array.isArray(sources) && sources.length > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6, gap: 6 }}>
          <Globe size={12} color={C.meta} />
          <Text style={{ fontSize: 10, fontWeight: "800", color: C.meta, letterSpacing: 0.5 }}>
            SOURCES CHECKED · TATA 1MG ({sources.length} PAGE{sources.length > 1 ? "S" : ""})
          </Text>
        </View>
      ) : null}
    </View>
    </HardShadow>
  );
}
