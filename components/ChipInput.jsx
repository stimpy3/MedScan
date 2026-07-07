// components/ChipInput.jsx
// Reusable free-text chip list with optional quick-pick suggestions. Used by profilePage for
// allergies, conditions, and other-medicines — anywhere a person needs to build up a short list.
import * as Haptics from 'expo-haptics';
import { Plus, X } from 'lucide-react-native';
import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import HardShadow from './HardShadow';

const C = {
  bg:      '#ede8d8',
  field:   '#f7f4ec',  // input/unselected fill — matches the profile page's form fields
  border:  '#2a2a2a',
  blue:    '#2198a8',
  dark:    '#2a2a2a',
  meta:    '#8a7850',
};

const BTN_SHADOW = {
  shadowColor: '#2a2a2a',
  shadowOffset: { width: 2, height: 2 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 3,
};

function tick() {
  try { Haptics.selectionAsync(); } catch { /* no-op on web */ }
}

export default function ChipInput({ label, values = [], onChange, quickPicks = [], placeholder }) {
  const [draft, setDraft] = useState('');

  const addValue = (raw) => {
    const v = raw.trim();
    if (!v) return;
    const exists = values.some(existing => existing.toLowerCase() === v.toLowerCase());
    if (!exists) { tick(); onChange([...values, v]); }
    setDraft('');
  };

  const removeValue = (v) => { tick(); onChange(values.filter(x => x !== v)); };

  const toggleQuickPick = (v) => {
    const on = values.some(existing => existing.toLowerCase() === v.toLowerCase());
    if (on) removeValue(values.find(x => x.toLowerCase() === v.toLowerCase()));
    else addValue(v);
  };

  return (
    <View>
      {label ? (
        <Text style={{ fontSize: 11, fontWeight: '800', color: C.meta, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
          {label}
        </Text>
      ) : null}

      {quickPicks.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {quickPicks.map(qp => {
            const on = values.some(v => v.toLowerCase() === qp.toLowerCase());
            return (
              <TouchableOpacity
                key={qp}
                activeOpacity={0.8}
                onPress={() => toggleQuickPick(qp)}
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: on ? C.blue : C.field, ...(on ? BTN_SHADOW : {}) }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: on ? '#fff' : C.meta }}>{qp}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {values.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {values.map(v => (
            <View key={v} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 8, paddingVertical: 8, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.bg }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: C.dark }}>{v}</Text>
              <TouchableOpacity onPress={() => removeValue(v)} hitSlop={6}>
                <X size={13} color={C.meta} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => addValue(draft)}
          placeholder={placeholder || 'Type and add'}
          placeholderTextColor="#b8b0a0"
          returnKeyType="done"
          style={{ flex: 1, fontSize: 13, fontWeight: '600', color: C.dark, backgroundColor: C.field, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 10 }}
        />
        <HardShadow offset={2}>
          <TouchableOpacity
            onPress={() => addValue(draft)}
            style={{ padding: 10, backgroundColor: C.blue, borderWidth: 1.5, borderColor: C.border, borderRadius: 4 }}
          >
            <Plus size={16} color="#fff" strokeWidth={2.5} />
          </TouchableOpacity>
        </HardShadow>
      </View>
    </View>
  );
}
