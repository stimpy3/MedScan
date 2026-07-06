import { ArrowLeftRight, Calendar, FileText, Pill } from 'lucide-react-native';
import { Text, TouchableOpacity, View } from 'react-native';
import HardShadow from './HardShadow';

const C = {
  bg:      '#ede8d8',
  surface: '#ffffff',
  border:  '#2a2a2a',
  blue:    '#2198a8',
  purple:  '#6b5390',
  dark:    '#2a2a2a',
};

// Icon + accent per intent, so the chooser reads like the home feature cards.
const META = {
  explain_medicine:  { icon: FileText,       accent: C.blue },
  compare_medicines: { icon: Pill,           accent: C.purple },
  find_alternatives: { icon: ArrowLeftRight, accent: C.blue },
  schedule_medicine: { icon: Calendar,       accent: C.purple },
};

// Shown when an image is uploaded with no stated goal — pick one of the four intents.
export default function IntentOptionsCard({ question, options, onSelect }) {
  return (
    <View style={{ width: '100%', marginVertical: 6 }}>
      {question ? (
        <HardShadow style={{ maxWidth: '85%', marginBottom: 10 }}>
          <View style={{ borderRadius: 4, borderTopLeftRadius: 0, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.border }}>
            <Text style={{ color: C.dark, fontSize: 16, lineHeight: 22 }}>{question}</Text>
          </View>
        </HardShadow>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {(options || []).map((opt) => {
          const meta = META[opt.intent] || { icon: Pill, accent: C.blue };
          const Icon = meta.icon;
          return (
            <HardShadow key={opt.intent} offset={2} style={{ width: '47%' }}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => onSelect?.(opt.label, { type: 'intent_pick', intent: opt.intent, intentLabel: opt.label })}
                style={{ backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, padding: 14 }}
              >
                <View style={{ backgroundColor: meta.accent, width: 38, height: 38, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                  <Icon size={18} color="#ffffff" />
                </View>
                <Text style={{ fontSize: 14, fontWeight: '900', color: C.dark }}>{opt.label}</Text>
              </TouchableOpacity>
            </HardShadow>
          );
        })}
      </View>
    </View>
  );
}
