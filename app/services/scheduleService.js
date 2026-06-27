// app/services/scheduleService.js
import AsyncStorage from '@react-native-async-storage/async-storage';

const SCHEDULE_KEY = 'medscan_scheduled_medicines';

// Generate unique ID for schedule
function generateId() {
  return `schedule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// Add a new scheduled medicine
export async function addSchedule(medicine) {
  try {
    const existing = await AsyncStorage.getItem(SCHEDULE_KEY);
    const schedules = existing ? JSON.parse(existing) : [];

    const newSchedule = {
      id: generateId(),
      ...medicine,
      createdAt: new Date().toISOString()
    };

    schedules.push(newSchedule);
    await AsyncStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedules));
    return newSchedule;
  } catch (err) {
    console.error('[scheduleService] Error adding schedule:', err);
    throw err;
  }
}

// Get all schedules
export async function getAllSchedules() {
  try {
    const data = await AsyncStorage.getItem(SCHEDULE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (err) {
    console.error('[scheduleService] Error getting schedules:', err);
    return [];
  }
}

// Get schedules for a specific day (0=Mon, 6=Sun)
export async function getSchedulesForDay(dayIndex) {
  try {
    const all = await getAllSchedules();
    return all.filter(s => s.days && s.days.includes(dayIndex));
  } catch (err) {
    console.error('[scheduleService] Error getting day schedules:', err);
    return [];
  }
}

// Update a schedule
export async function updateSchedule(id, updates) {
  try {
    const existing = await AsyncStorage.getItem(SCHEDULE_KEY);
    const schedules = existing ? JSON.parse(existing) : [];

    const idx = schedules.findIndex(s => s.id === id);
    if (idx === -1) throw new Error('Schedule not found');

    schedules[idx] = { ...schedules[idx], ...updates };
    await AsyncStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedules));
    return schedules[idx];
  } catch (err) {
    console.error('[scheduleService] Error updating schedule:', err);
    throw err;
  }
}

// Delete a schedule
export async function deleteSchedule(id) {
  try {
    const existing = await AsyncStorage.getItem(SCHEDULE_KEY);
    const schedules = existing ? JSON.parse(existing) : [];

    const filtered = schedules.filter(s => s.id !== id);
    await AsyncStorage.setItem(SCHEDULE_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.error('[scheduleService] Error deleting schedule:', err);
    throw err;
  }
}

// Get schedules for a date (YYYY-MM-DD format)
export async function getSchedulesForDate(dateString) {
  try {
    const date = new Date(dateString);
    const dayIndex = (date.getDay() + 6) % 7; // Convert JS day (0=Sun) to our format (0=Mon)
    return getSchedulesForDay(dayIndex);
  } catch (err) {
    console.error('[scheduleService] Error getting date schedules:', err);
    return [];
  }
}
