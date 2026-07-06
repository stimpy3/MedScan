// components/SafetyWarnings.jsx
// Renders the personalized safety check result attached to cardData.safety /
// comparisonData.safety.perMedicine (shared by MedicineCard now, ComparisonCard later).
// Renders nothing when the check never ran (no profile) — the card looks byte-identical to
// pre-safety-layer behavior for anyone without a profile.
import { Info, ShieldCheck, TriangleAlert } from "lucide-react-native";
import { Text, View } from "react-native";

const C = {
  bg:      "#ede8d8",
  surface: "#ffffff",
  border:  "#2a2a2a",
  dark:    "#2a2a2a",
  body:    "#444444",
  meta:    "#8a7850",
  high:    "#e53e3e",
  medium:  "#9f9065",
  low:     "#2198a8",
};

const SEVERITY_COLOR = { high: C.high, medium: C.medium, low: C.low };
const SEVERITY_TINT = { high: "rgba(229,62,62,0.08)", medium: "rgba(159,144,101,0.08)", low: "rgba(33,152,168,0.06)" };

function WarningRow({ warning }) {
  const color = SEVERITY_COLOR[warning.severity] || C.low;
  const Icon = warning.severity === "low" ? Info : TriangleAlert;
  return (
    <View style={{ flexDirection: "row", borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: SEVERITY_TINT[warning.severity] || C.surface, marginBottom: 8, overflow: "hidden" }}>
      <View style={{ width: 4, backgroundColor: color }} />
      <View style={{ flex: 1, flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 10, alignItems: "flex-start" }}>
        <Icon size={15} color={color} strokeWidth={2.5} style={{ marginTop: 1 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 9, fontWeight: "800", color, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 3 }}>
            {warning.severity} · {warning.type}
          </Text>
          <Text style={{ fontSize: 13, color: C.body, lineHeight: 18 }}>{warning.message}</Text>
        </View>
      </View>
    </View>
  );
}

export default function SafetyWarnings({ safety, compact = false, title = "For Your Profile" }) {
  if (!safety?.checked) return null;
  const warnings = safety.warnings || [];

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 10, fontWeight: "800", color: C.meta, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
        {title}
      </Text>

      {warnings.length > 0 ? (
        <>
          {warnings.map((w, i) => <WarningRow key={i} warning={w} />)}
          {safety.note ? (
            <Text style={{ fontSize: 12, color: C.body, lineHeight: 18, marginBottom: 8 }}>{safety.note}</Text>
          ) : null}
        </>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface, marginBottom: 8 }}>
          <ShieldCheck size={15} color={C.low} strokeWidth={2.5} />
          <Text style={{ fontSize: 11, fontWeight: "700", color: C.meta, letterSpacing: 0.3 }}>
            Checked against your profile — no specific concerns found
          </Text>
        </View>
      )}

      {!compact && (
        <Text style={{ fontSize: 10, color: C.meta, lineHeight: 14 }}>
          AI check based on the profile you entered — not medical advice. Confirm with a doctor or pharmacist.
        </Text>
      )}
    </View>
  );
}
