// components/ScheduleFormCard.jsx
import * as Haptics from 'expo-haptics';
import { Bell, Calendar, Check, Clock, FileText, Pill } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import HardShadow from './HardShadow';

const C = {
  bg:      '#ede8d8',
  surface: '#ffffff',
  border:  '#2a2a2a',
  blue:    '#2198a8',
  purple:  '#6b5390',
  dark:    '#2a2a2a',
  meta:    '#8a7850',
};

const SHADOW = {
  shadowColor: '#2a2a2a',
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 6,
};

const BTN_SHADOW = {
  shadowColor: '#2a2a2a',
  shadowOffset: { width: 2, height: 2 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 3,
};

const DAY_FULL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MEDICINE_TYPES = ['Pills', 'Capsules', 'Liquid'];
const INSTRUCTIONS = ['After eat', 'Before eat', 'While eating', 'None'];

const HOURS = ['1','2','3','4','5','6','7','8','9','10','11','12'];
const MINUTES = ['00','05','10','15','20','25','30','35','40','45','50','55'];
const PERIODS = ['AM', 'PM'];

const ITEM_H = 38;
const VISIBLE = 5;
const PICKER_H = ITEM_H * VISIBLE;
const PAD = ITEM_H * Math.floor(VISIBLE / 2);

function tick() {
  try { Haptics.selectionAsync(); } catch { /* no-op on web */ }
}

function DrumColumn({ values, selected, onChange, width = 58 }) {
  const ref = useRef(null);
  const scrollEndTimer = useRef(null);
  const didInit = useRef(false);
  const selectedIdx = Math.max(0, values.indexOf(String(selected)));

  const positionTo = (i, animated) => ref.current?.scrollTo({ y: i * ITEM_H, animated });

  const commit = (i) => {
    const idx = Math.max(0, Math.min(i, values.length - 1));
    if (values[idx] !== String(selected)) { onChange(values[idx]); tick(); }
  };

  const settle = (y) => {
    const i = Math.max(0, Math.min(Math.round(y / ITEM_H), values.length - 1));
    if (Math.abs(y - i * ITEM_H) > 1) positionTo(i, true);
    commit(i);
  };

  return (
    <View style={{ width, height: PICKER_H }}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        snapToAlignment="start"
        decelerationRate="fast"
        scrollEventThrottle={16}
        nestedScrollEnabled
        contentContainerStyle={{ paddingVertical: PAD }}
        onContentSizeChange={() => {
          if (!didInit.current) { positionTo(selectedIdx, false); didInit.current = true; }
        }}
        onScroll={(e) => {
          const y = e.nativeEvent.contentOffset.y;
          if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
          scrollEndTimer.current = setTimeout(() => settle(y), 120);
        }}
        onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.y)}
      >
        {values.map((v, i) => {
          const active = String(v) === String(selected);
          return (
            <TouchableOpacity
              key={v}
              activeOpacity={0.7}
              onPress={() => { positionTo(i, true); commit(i); }}
              style={{ height: ITEM_H, justifyContent: 'center', alignItems: 'center' }}
            >
              <Text style={{ fontSize: active ? 22 : 16, fontWeight: active ? '900' : '500', color: active ? C.purple : '#c9c2b0' }}>
                {v}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function parseTo12h(time24) {
  const [hStr, mStr] = (time24 || '09:00').split(':');
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h = h - 12;
  return { hour: String(h), minute: mStr || '00', period };
}

function to24h(hour, minute, period) {
  let h = parseInt(hour, 10);
  if (period === 'AM' && h === 12) h = 0;
  else if (period === 'PM' && h !== 12) h = h + 12;
  return `${String(h).padStart(2, '0')}:${minute}`;
}

const SectionLabel = ({ icon: Icon, children }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
    {Icon ? <Icon size={13} color={C.meta} strokeWidth={2.5} /> : null}
    <Text style={{ fontSize: 11, fontWeight: '800', color: C.meta, letterSpacing: 1, textTransform: 'uppercase' }}>
      {children}
    </Text>
  </View>
);

// One human line per duplicate-therapy group, excluding the medicine being added.
function duplicateLine(group, candidateName) {
  const others = (group.medicines || []).filter(n => n.toLowerCase() !== candidateName.toLowerCase());
  if (group.kind === 'already_scheduled') return 'This medicine is already in the schedule.';
  const who = others.join(', ') || 'another scheduled medicine';
  if (group.kind === 'same_ingredient') return `You're already taking ${who} — it contains the same active ingredient (${group.friendlyLabel || 'same salt'}).`;
  return `You're already taking ${who} — same therapeutic class (${group.friendlyLabel || group.className || 'similar medicine'}).`;
}

export default function ScheduleFormCard({ medicineName, onSubmit, onCheckDuplicates }) {
  const [name, setName] = useState(medicineName || '');
  const [medicineType, setMedicineType] = useState('Pills');
  const [dose, setDose] = useState('1');
  const [selectedDays, setSelectedDays] = useState([0, 2, 4]);
  const [instruction, setInstruction] = useState('After eat');
  const [notes, setNotes] = useState('');
  const [notificationEnabled, setNotificationEnabled] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingDuplicates, setPendingDuplicates] = useState(null); // groups awaiting "Add anyway"

  const initial = parseTo12h('09:00');
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [period, setPeriod] = useState(initial.period);

  const toggleDay = (dayIndex) => {
    tick();
    setSelectedDays(prev =>
      prev.includes(dayIndex) ? prev.filter(d => d !== dayIndex) : [...prev, dayIndex].sort((a, b) => a - b)
    );
  };

  const handleSubmit = async ({ skipDuplicateCheck = false } = {}) => {
    const finalName = (medicineName || name).trim();
    if (!finalName) { alert('Please enter a medicine name'); return; }
    if (selectedDays.length === 0) { alert('Please select at least one day'); return; }
    setIsSubmitting(true);
    try {
      // Confirm step: same-class/same-ingredient hits block until the user taps ADD ANYWAY.
      // The check fails open (returns []) — a network error never blocks scheduling.
      if (!skipDuplicateCheck && typeof onCheckDuplicates === 'function') {
        const groups = await onCheckDuplicates(finalName).catch(() => []);
        if (Array.isArray(groups) && groups.length > 0) {
          setPendingDuplicates(groups);
          return;
        }
      }
      setPendingDuplicates(null);
      await onSubmit({ medicineName: finalName, medicineType, dose, days: selectedDays, time: to24h(hour, minute, period), instruction, notes: notes.trim(), notificationEnabled });
    } catch (err) {
      console.error('Error submitting schedule:', err);
      alert('Failed to save schedule');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <HardShadow style={{ width: '100%', marginVertical: 10 }}>
      <View style={{ backgroundColor: C.bg, borderRadius: 4, padding: 22, borderWidth: 1.5, borderColor: C.border }}>

        {/* Header: purple icon square (purple = time everywhere in the app) + rotated badge */}
        <View style={{ marginBottom: 22 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <View style={{ width: 34, height: 34, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' }}>
              <Calendar size={16} color="#ffffff" strokeWidth={2.5} />
            </View>
            <View style={{ transform: [{ rotate: '-2deg' }], ...BTN_SHADOW }}>
              <View style={{ backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 5 }}>
                <Text style={{ fontSize: 11, fontWeight: '900', color: C.dark, letterSpacing: 1.5 }}>NEW SCHEDULE</Text>
              </View>
            </View>
          </View>
          {medicineName ? (
            <Text style={{ fontSize: 21, fontWeight: '900', color: C.dark }}>{medicineName}</Text>
          ) : (
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Medicine name"
              placeholderTextColor="#b8b0a0"
              style={{ fontSize: 18, fontWeight: '900', color: C.dark, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 10 }}
            />
          )}
        </View>

        {/* Medicine Type */}
        <View style={{ marginBottom: 22 }}>
          <SectionLabel icon={Pill}>Form</SectionLabel>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {MEDICINE_TYPES.map(type => {
              const on = medicineType === type;
              return (
                <TouchableOpacity
                  key={type}
                  activeOpacity={0.8}
                  onPress={() => { tick(); setMedicineType(type); }}
                  style={{ flex: 1, paddingVertical: 11, borderRadius: 4, alignItems: 'center', borderWidth: 1.5, borderColor: C.border, backgroundColor: on ? C.blue : C.surface, ...(on ? BTN_SHADOW : {}) }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '800', color: on ? '#ffffff' : C.meta }}>{type}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Dose */}
        <View style={{ marginBottom: 22 }}>
          <SectionLabel>Dose per intake</SectionLabel>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {['1', '2', '3', '4'].map(d => {
              const on = dose === d;
              return (
                <TouchableOpacity
                  key={d}
                  activeOpacity={0.8}
                  onPress={() => { tick(); setDose(d); }}
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 4, alignItems: 'center', borderWidth: 1.5, borderColor: C.border, backgroundColor: on ? C.blue : C.surface, ...(on ? BTN_SHADOW : {}) }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '900', color: on ? '#ffffff' : C.meta }}>{d}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Days */}
        <View style={{ marginBottom: 22 }}>
          <SectionLabel icon={Calendar}>Days</SectionLabel>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {DAY_FULL.map((day, idx) => {
              const on = selectedDays.includes(idx);
              return (
                <TouchableOpacity
                  key={day}
                  activeOpacity={0.8}
                  onPress={() => toggleDay(idx)}
                  style={{ flex: 1, height: 44, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.border, backgroundColor: on ? C.purple : C.surface, ...(on ? BTN_SHADOW : {}) }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '800', color: on ? '#ffffff' : C.meta }}>{day[0]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Time picker */}
        <View style={{ marginBottom: 22 }}>
          <SectionLabel icon={Clock}>Time</SectionLabel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, height: PICKER_H, borderRadius: 4, overflow: 'hidden', backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border, justifyContent: 'center' }}>
              <View pointerEvents="none" style={{ position: 'absolute', left: 14, right: 14, top: PAD, height: ITEM_H, backgroundColor: 'rgba(107,83,144,0.12)', borderRadius: 4 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                <DrumColumn values={HOURS} selected={hour} onChange={setHour} />
                <Text style={{ fontSize: 22, fontWeight: '900', color: C.purple, paddingHorizontal: 2 }}>:</Text>
                <DrumColumn values={MINUTES} selected={minute} onChange={setMinute} />
              </View>
            </View>

            <View style={{ height: PICKER_H, gap: 8, justifyContent: 'center' }}>
              {PERIODS.map(p => {
                const on = period === p;
                return (
                  <TouchableOpacity
                    key={p}
                    activeOpacity={0.8}
                    onPress={() => { tick(); setPeriod(p); }}
                    style={{ width: 56, flex: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.border, backgroundColor: on ? C.purple : C.surface, ...(on ? BTN_SHADOW : {}) }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '900', color: on ? '#fff' : C.meta }}>{p}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* Instructions */}
        <View style={{ marginBottom: 22 }}>
          <SectionLabel>Instructions</SectionLabel>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {INSTRUCTIONS.map(instr => {
              const on = instruction === instr;
              return (
                <TouchableOpacity
                  key={instr}
                  activeOpacity={0.8}
                  onPress={() => { tick(); setInstruction(instr); }}
                  style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: on ? C.blue : C.surface, ...(on ? BTN_SHADOW : {}) }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '800', color: on ? '#fff' : C.meta }}>{instr}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Notes */}
        <View style={{ marginBottom: 22 }}>
          <SectionLabel icon={FileText}>Notes</SectionLabel>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional — e.g. take with a full glass of water"
            placeholderTextColor="#b8b0a0"
            multiline
            style={{ minHeight: 72, textAlignVertical: 'top', fontSize: 13, fontWeight: '600', color: C.dark, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 10 }}
          />
        </View>

        {/* Notification Toggle */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 14, backgroundColor: C.surface, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, marginBottom: 22 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Bell size={15} color={C.blue} strokeWidth={2.5} />
            <Text style={{ fontSize: 13, fontWeight: '800', color: C.dark }}>Reminders</Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => { tick(); setNotificationEnabled(v => !v); }}
            style={{ width: 50, height: 28, borderRadius: 14, backgroundColor: notificationEnabled ? C.blue : '#d8d0bc', justifyContent: 'center', borderWidth: 1.5, borderColor: C.border }}
          >
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1.5, borderColor: C.border, alignSelf: notificationEnabled ? 'flex-end' : 'flex-start', marginHorizontal: 2 }} />
          </TouchableOpacity>
        </View>

        {/* Duplicate-therapy confirm step — blocks until ADD ANYWAY or CANCEL */}
        {pendingDuplicates ? (
          <View style={{ backgroundColor: '#ffe0e0', borderWidth: 1.5, borderColor: '#e53e3e', borderRadius: 4, padding: 12, marginBottom: 14 }}>
            <Text style={{ color: '#c0392b', fontSize: 11, fontWeight: '900', letterSpacing: 0.5, marginBottom: 6 }}>
              ⚠ DUPLICATE THERAPY CHECK
            </Text>
            {pendingDuplicates.map((g, i) => (
              <Text key={i} style={{ color: '#c0392b', fontSize: 12, fontWeight: '700', lineHeight: 17, marginBottom: 4 }}>
                {duplicateLine(g, (medicineName || name).trim())}
              </Text>
            ))}
            <Text style={{ color: '#c0392b', fontSize: 11, fontWeight: '600', marginBottom: 10 }}>
              Verify this combination with your doctor. Add anyway?
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => { tick(); handleSubmit({ skipDuplicateCheck: true }); }}
                style={{ flex: 1, backgroundColor: '#e53e3e', borderRadius: 4, borderWidth: 1.5, borderColor: C.border, paddingVertical: 11, alignItems: 'center' }}
              >
                <Text style={{ fontSize: 12, fontWeight: '900', color: '#fff', letterSpacing: 0.5 }}>ADD ANYWAY</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => { tick(); setPendingDuplicates(null); }}
                style={{ flex: 1, backgroundColor: C.surface, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, paddingVertical: 11, alignItems: 'center' }}
              >
                <Text style={{ fontSize: 12, fontWeight: '900', color: C.dark, letterSpacing: 0.5 }}>CANCEL</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* Submit */}
        <HardShadow>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => handleSubmit()}
            disabled={isSubmitting}
            style={{ flexDirection: 'row', gap: 8, backgroundColor: C.blue, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', opacity: isSubmitting ? 0.7 : 1 }}
          >
            {!isSubmitting && <Check size={16} color="#ffffff" strokeWidth={3} />}
            <Text style={{ fontSize: 15, fontWeight: '900', color: '#fff', letterSpacing: 0.5 }}>
              {isSubmitting ? 'Saving…' : 'Confirm Schedule'}
            </Text>
          </TouchableOpacity>
        </HardShadow>
      </View>
    </HardShadow>
  );
}
