import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, Bell, BellOff, Calendar, Check, Clock, FileText, Pill, Plus, Trash2, ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { getAllSchedules, getSchedulesForDate, deleteSchedule, addSchedule } from '../services/scheduleService';
import { getProfilesState } from '../services/profileService';
import { checkDuplicateGroups, checkBeforeSchedule } from '../services/duplicateCheckService';
import HardShadow from '../../components/HardShadow';
import ScheduleFormCard from '../../components/ScheduleFormCard';
import SafetyWarnings from '../../components/SafetyWarnings';
import { RemindersSkeleton } from '../../components/Skeletons';

const C = {
  bg:      '#f7f4ec',   // warm paper — same family as home and profiles
  surface: '#ede8d8',
  border:  '#2a2a2a',
  blue:    '#2198a8',
  purple:  '#6b5390',
  dark:    '#2a2a2a',
  meta:    '#8a7850',
  danger:  '#e53e3e',
  purpleLight: 'rgba(107,83,144,0.1)',
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function hourLabel(hour) {
  if (hour === 0) return '12am';
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return '12pm';
  return `${hour - 12}pm`;
}

function formatTime12(time24) {
  const [hStr, mStr] = (time24 || '09:00').split(':');
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h = h - 12;
  return `${h}:${mStr || '00'} ${period}`;
}

function groupByHour(schedules) {
  const map = {};
  for (const s of schedules) {
    const hour = parseInt(s.time.split(':')[0], 10);
    if (!map[hour]) map[hour] = [];
    map[hour].push(s);
  }
  return map;
}

export default function RemindersPage() {
  const router = useRouter();
  const monthScrollRef = useRef(null);
  const [schedules, setSchedules] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [daySchedules, setDaySchedules] = useState([]);
  const [currentMonthOffset, setCurrentMonthOffset] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [loading, setLoading] = useState(true); // first load only — refocus refreshes stay silent
  // Family mode: which member's reminders are on screen. Defaults to the active profile;
  // the ref mirrors the state so async loads never read a stale filter.
  const [profiles, setProfiles] = useState([]);
  const [filterProfileId, setFilterProfileId] = useState(null);
  const [duplicateGroups, setDuplicateGroups] = useState([]); // same-class/ingredient pairs in this profile's schedules
  const filterRef = useRef(null);
  const timelineRef = useRef(null);
  const rowOffsets = useRef({});
  const [now, setNow] = useState(new Date());

  const currentHour = now.getHours();
  // Show one hour before the current one at the top of the timeline
  const scrollTargetHour = Math.max(0, currentHour - 1);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const scrollToNow = (animated = true) => {
    const y = rowOffsets.current[scrollTargetHour];
    if (y != null) timelineRef.current?.scrollTo({ y, animated });
  };

  useEffect(() => { scrollToNow(); }, [currentHour]);

  useEffect(() => {
    if (loading) return; // strip isn't mounted while the skeleton shows
    // Scroll month strip to center on current month (~58px per pill)
    const currentMonthIdx = new Date().getMonth();
    const { width } = Dimensions.get('window');
    const PILL_W = 58;
    const x = currentMonthIdx * PILL_W - (width - 80) / 2 + PILL_W / 2;
    setTimeout(() => monthScrollRef.current?.scrollTo({ x: Math.max(0, x), animated: false }), 100);
  }, [loading]);

  useFocusEffect(useCallback(() => { loadSchedules(); }, []));

  const loadSchedules = async (pidOverride) => {
    try {
      const state = await getProfilesState();
      setProfiles(state.profiles);
      let pid = pidOverride ?? filterRef.current;
      if (!pid || !state.profiles.some(p => p.id === pid)) pid = state.activeProfileId;
      filterRef.current = pid;
      setFilterProfileId(pid);
      const all = await getAllSchedules(pid);
      setSchedules(all);
      loadDaySchedules(selectedDate, all);
      refreshDuplicateBanner(all);
    } catch (err) {
      console.error('Error loading schedules:', err);
    } finally {
      setLoading(false);
    }
  };

  // Duplicate-therapy banner: same-class/same-ingredient pairs across this profile's schedules.
  // Fire-and-forget — the check fails open and the banner only renders when groups exist.
  const refreshDuplicateBanner = (all) => {
    const names = [...new Set((all || []).map(s => s.medicineName).filter(Boolean))];
    if (names.length < 2) { setDuplicateGroups([]); return; }
    checkDuplicateGroups(names).then(setDuplicateGroups).catch(() => setDuplicateGroups([]));
  };

  const handleProfileFilter = (pid) => {
    if (pid !== filterRef.current) loadSchedules(pid);
  };

  const loadDaySchedules = async (date, allSchedules) => {
    const scheds = (allSchedules || schedules).filter(s => {
      const dayIndex = (date.getDay() + 6) % 7;
      return s.days && s.days.includes(dayIndex);
    });
    scheds.sort((a, b) => a.time.localeCompare(b.time));
    setDaySchedules(scheds);
  };

  const handleDateSelect = (date) => {
    setSelectedDate(date);
    loadDaySchedules(date, schedules);
  };

  const handleDelete = async (id) => {
    try {
      await deleteSchedule(id);
      setSelectedSchedule(null);
      const all = await getAllSchedules(filterRef.current);
      setSchedules(all);
      loadDaySchedules(selectedDate, all);
    } catch (err) {
      console.error('Error deleting schedule:', err);
    }
  };

  const handleAddSubmit = async (formData) => {
    // New reminders belong to whichever member's tab is currently open.
    await addSchedule(formData, filterRef.current);
    setShowAddForm(false);
    await loadSchedules();
  };

  const getWeekDates = () => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  };

  const hasScheduleOnDay = (date) => {
    const dayIndex = (date.getDay() + 6) % 7;
    return schedules.some(s => s.days && s.days.includes(dayIndex));
  };

  const weekDates = getWeekDates();
  const currentMonth = new Date();
  currentMonth.setMonth(currentMonth.getMonth() + currentMonthOffset);

  const grouped = groupByHour(daySchedules);
  const activeHours = Object.keys(grouped).map(Number).sort((a, b) => a - b);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 52 }}>
          <RemindersSkeleton />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 52, paddingBottom: 0 }}>

        <View style={{ paddingBottom: 0, marginBottom: 0 }}>

          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16, borderBottomWidth: 1.5, borderBottomColor: C.border, marginBottom: 16 }}>
            <HardShadow offset={2}>
              <TouchableOpacity
                style={{ padding: 8, backgroundColor: C.blue, borderWidth: 1.5, borderColor: C.border, borderRadius: 4 }}
                onPress={() => router.back()}
              >
                <ArrowLeft size={20} color="#ffffff" />
              </TouchableOpacity>
            </HardShadow>
            {/* rotated sticker-badge title — same treatment as the profiles page */}
            <View style={{ transform: [{ rotate: '-2deg' }], ...BTN_SHADOW }}>
              <View style={{ backgroundColor: '#ffffff', borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 14, paddingVertical: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: '900', color: C.dark, letterSpacing: 1.5 }}>MY REMINDERS</Text>
              </View>
            </View>
            <HardShadow offset={2}>
              <TouchableOpacity
                style={{ padding: 8, backgroundColor: C.purple, borderWidth: 1.5, borderColor: C.border, borderRadius: 4 }}
                onPress={() => setShowAddForm(true)}
              >
                <Plus size={20} color="#ffffff" strokeWidth={2.5} />
              </TouchableOpacity>
            </HardShadow>
          </View>

          {/* Profile filter (family mode) — only when there's more than one member */}
          {profiles.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ marginBottom: 14 }}>
              {profiles.map(p => {
                const sel = p.id === filterProfileId;
                return (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => handleProfileFilter(p.id)}
                    style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: sel ? C.purple : C.surface, ...(sel ? BTN_SHADOW : {}) }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '800', color: sel ? '#fff' : C.dark }}>{p.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Month strip */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <TouchableOpacity onPress={() => setCurrentMonthOffset(p => p - 1)} style={{ padding: 6 }}>
              <ChevronLeft size={20} color={C.dark} />
            </TouchableOpacity>
            <ScrollView ref={monthScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 4 }} style={{ flex: 1 }}>
              {MONTHS.map((m, i) => {
                const sel = i === currentMonth.getMonth();
                return (
                  <TouchableOpacity
                    key={i}
                    onPress={() => setCurrentMonthOffset(i - new Date().getMonth())}
                    style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: sel ? C.blue : '#ede8d8', ...(sel ? BTN_SHADOW : {}) }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '800', color: sel ? '#fff' : C.dark }}>{m}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity onPress={() => setCurrentMonthOffset(p => p + 1)} style={{ padding: 6 }}>
              <ChevronRight size={20} color={C.dark} />
            </TouchableOpacity>
          </View>

          {/* Week date row */}
          <View style={{ flexDirection: 'row', gap: 5 }}>
            {weekDates.map((date, idx) => {
              const isSelected = date.toDateString() === selectedDate.toDateString();
              const hasDot = hasScheduleOnDay(date);
              const dayLabel = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][idx];
              return (
                <TouchableOpacity
                  key={idx}
                  onPress={() => handleDateSelect(date)}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: isSelected ? C.purple : '#ede8d8', ...(isSelected ? BTN_SHADOW : {}) }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '900', color: isSelected ? '#fff' : C.dark, marginBottom: 3 }}>
                    {date.getDate()}
                  </Text>
                  <Text style={{ fontSize: 9, fontWeight: '700', color: isSelected ? 'rgba(255,255,255,0.8)' : C.meta }}>
                    {dayLabel}
                  </Text>
                  {hasDot && (
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: isSelected ? 'rgba(255,255,255,0.9)' : C.purple, marginTop: 4 }} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

        </View>

        {/* Selected day + schedule count */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 10 }}>
          <Text style={{ fontSize: 12, fontWeight: '900', color: C.dark, letterSpacing: 0.3 }}>
            {selectedDate.toDateString() === new Date().toDateString()
              ? 'Today'
              : `${DAY_LABELS[(selectedDate.getDay() + 6) % 7]}, ${MONTHS[selectedDate.getMonth()]} ${selectedDate.getDate()}`}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.blue }} />
            <Text style={{ fontSize: 10, fontWeight: '800', color: C.blue, letterSpacing: 1, textTransform: 'uppercase' }}>
              {daySchedules.length > 0
                ? `${daySchedules.length} medicine${daySchedules.length !== 1 ? 's' : ''}`
                : 'No medicines'}
            </Text>
          </View>
        </View>

        {/* Duplicate-therapy banner — only rendered when same-class/ingredient pairs exist */}
        {duplicateGroups.length > 0 && (
          <View style={{ marginBottom: 10 }}>
            <SafetyWarnings
              compact
              title="Duplicate therapy check"
              safety={{
                checked: true,
                warnings: duplicateGroups.map(g => ({
                  severity: g.kind === 'same_ingredient' ? 'high' : 'medium',
                  type: 'duplicate therapy',
                  message: g.kind === 'same_ingredient'
                    ? `${(g.medicines || []).join(' and ')} contain the same active ingredient (${g.friendlyLabel || 'same salt'}). Taking both risks double-dosing — verify with your doctor.`
                    : `${(g.medicines || []).join(' and ')} are in the same therapeutic class (${g.friendlyLabel || g.className || 'similar medicines'}). Verify this combination with your doctor.`
                })),
                note: null
              }}
            />
          </View>
        )}

        {/* Timeline */}
        <ScrollView ref={timelineRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          {HOURS.map((hour) => {
            const items = grouped[hour];
            const hasItems = items && items.length > 0;
            const isActive = hour === currentHour;
            return (
              <View
                key={hour}
                style={{ flexDirection: 'row', minHeight: 64 }}
                onLayout={(e) => {
                  rowOffsets.current[hour] = e.nativeEvent.layout.y;
                  if (hour === scrollTargetHour) scrollToNow(false);
                }}
              >
                <View style={{ width: 44, paddingTop: 4 }}>
                  <Text style={{ fontSize: 11, fontWeight: isActive ? '900' : '700', color: isActive ? C.purple : hasItems ? C.dark : C.meta }}>
                    {hourLabel(hour)}
                  </Text>
                </View>

                <View style={{ flex: 1, borderTopWidth: 2, borderTopColor: isActive ? C.purple : hasItems ? 'rgba(42,42,42,0.35)' : 'rgba(42,42,42,0.1)', paddingTop: 8, paddingBottom: 8, backgroundColor: isActive ? C.purpleLight : 'transparent', ...(isActive ? { borderBottomLeftRadius: 4, borderBottomRightRadius: 4, paddingHorizontal: 6 } : {}) }}>
                  {hasItems ? (
                    <>
                      {/* Swipe hint — only when the row actually scrolls */}
                      {items.length > 1 && (
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 6 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: '#ffffff' }}>
                            <Text style={{ fontSize: 9, fontWeight: '800', color: C.purple, letterSpacing: 0.5 }}>
                              {items.length} MEDS · SWIPE
                            </Text>
                            <ChevronRight size={10} color={C.purple} strokeWidth={3} />
                          </View>
                        </View>
                      )}
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      // 200 card + 4 shadow + 10 gap → cards page one at a time
                      snapToInterval={214}
                      decelerationRate="fast"
                      contentContainerStyle={{ gap: 10, paddingRight: 20 }}
                    >
                      {items.map((sched) => (
                        <HardShadow key={sched.id} style={{ width: 200 }}>
                        <TouchableOpacity
                          activeOpacity={0.8}
                          onPress={() => setSelectedSchedule(sched)}
                          style={{ backgroundColor: '#ffffff', borderRadius: 4, padding: 12, borderWidth: 1.5, borderColor: C.border }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                            <View style={{ flex: 1, marginRight: 8 }}>
                              <Text style={{ fontSize: 13, fontWeight: '900', color: C.dark, marginBottom: 3 }} numberOfLines={1}>
                                {sched.medicineName}
                              </Text>
                              <Text style={{ fontSize: 11, fontWeight: '600', color: C.meta }}>
                                {sched.dose} · {sched.medicineType}
                              </Text>
                              {sched.instruction && sched.instruction !== 'None' ? (
                                <View style={{ alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface }}>
                                  <Text style={{ fontSize: 9, fontWeight: '800', color: C.purple, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                    {sched.instruction}
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                            <View style={{ flexDirection: 'row', gap: 4 }}>
                              <TouchableOpacity style={{ padding: 6, backgroundColor: C.blue, borderRadius: 4, borderWidth: 1.5, borderColor: C.border }}>
                                <Check size={13} color="#fff" strokeWidth={3} />
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => handleDelete(sched.id)} style={{ padding: 6, backgroundColor: '#ffe0e0', borderRadius: 4, borderWidth: 1.5, borderColor: C.border }}>
                                <Trash2 size={13} color={C.danger} />
                              </TouchableOpacity>
                            </View>
                          </View>
                        </TouchableOpacity>
                        </HardShadow>
                      ))}
                    </ScrollView>
                    </>
                  ) : null}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>

      {/* Add schedule modal */}
      <Modal visible={showAddForm} transparent animationType="slide" onRequestClose={() => setShowAddForm(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: 'rgba(42,42,42,0.55)' }}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 64, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10 }}>
              <HardShadow offset={2}>
                <TouchableOpacity
                  onPress={() => setShowAddForm(false)}
                  style={{ padding: 8, backgroundColor: C.danger, borderWidth: 1.5, borderColor: C.border, borderRadius: 4 }}
                >
                  <X size={20} color="#ffffff" strokeWidth={2.5} />
                </TouchableOpacity>
              </HardShadow>
            </View>
            <ScheduleFormCard
              onSubmit={handleAddSubmit}
              onCheckDuplicates={(name) => checkBeforeSchedule(name, filterRef.current)}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Reminder detail modal */}
      <Modal visible={!!selectedSchedule} transparent animationType="fade" onRequestClose={() => setSelectedSchedule(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(42,42,42,0.55)', justifyContent: 'center', paddingHorizontal: 20 }}>
          {selectedSchedule && (
            <HardShadow style={{ width: '100%' }}>
              <View style={{ backgroundColor: C.surface, borderRadius: 4, padding: 22, borderWidth: 1.5, borderColor: C.border }}>

                {/* Header */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
                  <View style={{ flex: 1, marginRight: 10 }}>
                    <View style={{ backgroundColor: C.purple, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, marginBottom: 8 }}>
                      <Text style={{ fontSize: 11, fontWeight: '800', color: '#ffffff', letterSpacing: 1.5, textTransform: 'uppercase' }}>Reminder</Text>
                    </View>
                    <Text style={{ fontSize: 20, fontWeight: '900', color: C.dark }}>{selectedSchedule.medicineName}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setSelectedSchedule(null)}
                    style={{ padding: 6, backgroundColor: C.danger, borderWidth: 1.5, borderColor: C.border, borderRadius: 4 }}
                  >
                    <X size={16} color="#ffffff" strokeWidth={2.5} />
                  </TouchableOpacity>
                </View>

                {/* Time + dose row */}
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  <View style={{ flex: 1, backgroundColor: '#ffffff', borderRadius: 4, borderWidth: 1.5, borderColor: C.border, padding: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                      <Clock size={12} color={C.meta} strokeWidth={2.5} />
                      <Text style={{ fontSize: 10, fontWeight: '800', color: C.meta, letterSpacing: 1, textTransform: 'uppercase' }}>Time</Text>
                    </View>
                    <Text style={{ fontSize: 16, fontWeight: '900', color: C.dark }}>{formatTime12(selectedSchedule.time)}</Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: '#ffffff', borderRadius: 4, borderWidth: 1.5, borderColor: C.border, padding: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                      <Pill size={12} color={C.meta} strokeWidth={2.5} />
                      <Text style={{ fontSize: 10, fontWeight: '800', color: C.meta, letterSpacing: 1, textTransform: 'uppercase' }}>Dose</Text>
                    </View>
                    <Text style={{ fontSize: 16, fontWeight: '900', color: C.dark }}>{selectedSchedule.dose} · {selectedSchedule.medicineType}</Text>
                  </View>
                </View>

                {/* Days */}
                <View style={{ backgroundColor: '#ffffff', borderRadius: 4, borderWidth: 1.5, borderColor: C.border, padding: 12, marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 }}>
                    <Calendar size={12} color={C.meta} strokeWidth={2.5} />
                    <Text style={{ fontSize: 10, fontWeight: '800', color: C.meta, letterSpacing: 1, textTransform: 'uppercase' }}>Days</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 5 }}>
                    {DAY_LABELS.map((day, idx) => {
                      const on = selectedSchedule.days && selectedSchedule.days.includes(idx);
                      return (
                        <View key={day} style={{ flex: 1, paddingVertical: 7, borderRadius: 4, alignItems: 'center', borderWidth: 1.5, borderColor: on ? C.border : 'rgba(42,42,42,0.2)', backgroundColor: on ? C.purple : 'transparent' }}>
                          <Text style={{ fontSize: 10, fontWeight: '800', color: on ? '#fff' : '#b8b0a0' }}>{day[0]}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>

                {/* Instruction + reminders row */}
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: selectedSchedule.notes ? 12 : 18 }}>
                  <View style={{ flex: 1, backgroundColor: '#ffffff', borderRadius: 4, borderWidth: 1.5, borderColor: C.border, padding: 12 }}>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: C.meta, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Instructions</Text>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: C.dark }}>
                      {selectedSchedule.instruction && selectedSchedule.instruction !== 'None' ? selectedSchedule.instruction : '—'}
                    </Text>
                  </View>
                  <View style={{ flex: 1, backgroundColor: '#ffffff', borderRadius: 4, borderWidth: 1.5, borderColor: C.border, padding: 12 }}>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: C.meta, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Reminders</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {selectedSchedule.notificationEnabled !== false
                        ? <Bell size={14} color={C.blue} strokeWidth={2.5} />
                        : <BellOff size={14} color={C.meta} strokeWidth={2.5} />}
                      <Text style={{ fontSize: 13, fontWeight: '800', color: selectedSchedule.notificationEnabled !== false ? C.blue : C.meta }}>
                        {selectedSchedule.notificationEnabled !== false ? 'On' : 'Off'}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Notes */}
                {selectedSchedule.notes ? (
                  <View style={{ backgroundColor: '#ffffff', borderRadius: 4, borderWidth: 1.5, borderColor: C.border, padding: 12, marginBottom: 18 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                      <FileText size={12} color={C.meta} strokeWidth={2.5} />
                      <Text style={{ fontSize: 10, fontWeight: '800', color: C.meta, letterSpacing: 1, textTransform: 'uppercase' }}>Notes</Text>
                    </View>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: C.dark, lineHeight: 19 }}>{selectedSchedule.notes}</Text>
                  </View>
                ) : null}

                {/* Delete */}
                <HardShadow offset={2}>
                  <TouchableOpacity
                    onPress={() => handleDelete(selectedSchedule.id)}
                    style={{ flexDirection: 'row', gap: 8, backgroundColor: '#ffe0e0', borderRadius: 4, borderWidth: 1.5, borderColor: C.border, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Trash2 size={15} color={C.danger} />
                    <Text style={{ fontSize: 13, fontWeight: '900', color: C.danger }}>Delete Reminder</Text>
                  </TouchableOpacity>
                </HardShadow>

              </View>
            </HardShadow>
          )}
        </View>
      </Modal>
    </View>
  );
}
