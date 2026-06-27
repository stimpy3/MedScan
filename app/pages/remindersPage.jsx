import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, Check, Trash2, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { getAllSchedules, getSchedulesForDate, deleteSchedule } from '../services/scheduleService';
import HardShadow from '../../components/HardShadow';

const C = {
  bg:      '#ffffff',
  surface: '#ede8d8',
  border:  '#2a2a2a',
  blue:    '#2198a8',
  purple:  '#6b5390',
  dark:    '#2a2a2a',
  meta:    '#8a7850',
  danger:  '#e53e3e',
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
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7);

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

  useEffect(() => {
    // Scroll month strip to center on current month (~58px per pill)
    const currentMonthIdx = new Date().getMonth();
    const { width } = Dimensions.get('window');
    const PILL_W = 58;
    const x = currentMonthIdx * PILL_W - (width - 80) / 2 + PILL_W / 2;
    setTimeout(() => monthScrollRef.current?.scrollTo({ x: Math.max(0, x), animated: false }), 100);
  }, []);

  useFocusEffect(useCallback(() => { loadSchedules(); }, []));

  const loadSchedules = async () => {
    try {
      const all = await getAllSchedules();
      setSchedules(all);
      loadDaySchedules(selectedDate, all);
    } catch (err) {
      console.error('Error loading schedules:', err);
    }
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
      const all = await getAllSchedules();
      setSchedules(all);
      loadDaySchedules(selectedDate, all);
    } catch (err) {
      console.error('Error deleting schedule:', err);
    }
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
            <Text style={{ fontSize: 17, fontWeight: '900', color: C.dark }}>My Reminders</Text>
            <View style={{ width: 36 }} />
          </View>

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

        {/* Schedule count */}
        <Text style={{ fontSize: 13, fontWeight: '900', color: C.dark, marginBottom: 12, letterSpacing: 0.2 }}>
          {daySchedules.length > 0
            ? `${daySchedules.length} medicine${daySchedules.length !== 1 ? 's' : ''} today`
            : 'No medicines scheduled'}
        </Text>

        {/* Timeline */}
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          {HOURS.map((hour) => {
            const items = grouped[hour];
            const hasItems = items && items.length > 0;
            return (
              <View key={hour} style={{ flexDirection: 'row', minHeight: 64 }}>
                <View style={{ width: 44, paddingTop: 4 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: hasItems ? C.purple : C.meta }}>
                    {hour > 12 ? `${hour - 12}pm` : hour === 12 ? '12pm' : `${hour}am`}
                  </Text>
                </View>

                <View style={{ flex: 1, borderTopWidth: 2, borderTopColor: hasItems ? C.purple : 'rgba(42,42,42,0.1)', paddingTop: 8, paddingBottom: 8 }}>
                  {hasItems ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                      {items.map((sched) => (
                        <HardShadow key={sched.id} style={{ width: 200 }}>
                        <View
                          style={{ backgroundColor: C.surface, borderRadius: 4, padding: 12, borderWidth: 1.5, borderColor: C.border }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                            <View style={{ flex: 1, marginRight: 8 }}>
                              <Text style={{ fontSize: 13, fontWeight: '900', color: C.dark, marginBottom: 3 }} numberOfLines={1}>
                                {sched.medicineName}
                              </Text>
                              <Text style={{ fontSize: 11, fontWeight: '600', color: C.meta }}>
                                {sched.dose} · {sched.medicineType}
                              </Text>
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
                        </View>
                        </HardShadow>
                      ))}
                    </ScrollView>
                  ) : null}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}
