// app/services/scheduleService.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isLoggedIn, authFetch } from './authService';

const SCHEDULE_KEY = 'medscan_scheduled_medicines';

// Generate unique ID for schedule
function generateId() {
  return `schedule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function readAll() {
  const data = await AsyncStorage.getItem(SCHEDULE_KEY);
  return data ? JSON.parse(data) : [];
}

async function writeAll(schedules) {
  await AsyncStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedules));
}

// Add a new scheduled medicine. profileId stamps which member profile it belongs to (Netflix-style
// multi-profile — see app/services/profileService.js); omit only for pre-profile-layer callers.
// Signed in → the server creates the record and its id becomes the local id.
export async function addSchedule(medicine, profileId = null) {
  try {
    const schedules = await readAll();

    let newSchedule;
    if (profileId && (await isLoggedIn())) {
      const { schedule } = await authFetch('/api/schedules', {
        method: 'POST',
        body: JSON.stringify({ ...medicine, profileId })
      });
      newSchedule = schedule;
    } else {
      newSchedule = {
        id: generateId(),
        profileId,
        ...medicine,
        createdAt: new Date().toISOString()
      };
    }

    schedules.push(newSchedule);
    await writeAll(schedules);
    return newSchedule;
  } catch (err) {
    console.error('[scheduleService] Error adding schedule:', err);
    throw err;
  }
}

// Get all schedules. Pass profileId to filter to one member's reminders; omit/null for everyone's
// (used by profileService for migration and by call sites that predate multi-profile support).
export async function getAllSchedules(profileId = null) {
  try {
    const data = await AsyncStorage.getItem(SCHEDULE_KEY);
    const all = data ? JSON.parse(data) : [];
    return profileId ? all.filter(s => s.profileId === profileId) : all;
  } catch (err) {
    console.error('[scheduleService] Error getting schedules:', err);
    return [];
  }
}

// Get schedules for a specific day (0=Mon, 6=Sun), optionally scoped to one profile.
export async function getSchedulesForDay(dayIndex, profileId = null) {
  try {
    const all = await getAllSchedules(profileId);
    return all.filter(s => s.days && s.days.includes(dayIndex));
  } catch (err) {
    console.error('[scheduleService] Error getting day schedules:', err);
    return [];
  }
}

// Stamps profileId onto any schedule that doesn't have one yet (pre-profile-layer data).
// Idempotent — a no-op once every schedule has a profileId.
export async function migrateSchedulesToProfile(profileId) {
  try {
    const existing = await AsyncStorage.getItem(SCHEDULE_KEY);
    const schedules = existing ? JSON.parse(existing) : [];
    let changed = false;
    for (const s of schedules) {
      if (!s.profileId) { s.profileId = profileId; changed = true; }
    }
    if (changed) await AsyncStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedules));
  } catch (err) {
    console.error('[scheduleService] Error migrating schedules to profile:', err);
  }
}

// Re-points every schedule belonging to a deleted profile onto the profile that replaces it.
export async function reassignSchedules(fromProfileId, toProfileId) {
  try {
    const existing = await AsyncStorage.getItem(SCHEDULE_KEY);
    const schedules = existing ? JSON.parse(existing) : [];
    let changed = false;
    for (const s of schedules) {
      if (s.profileId === fromProfileId) { s.profileId = toProfileId; changed = true; }
    }
    if (changed) await AsyncStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedules));
  } catch (err) {
    console.error('[scheduleService] Error reassigning schedules:', err);
  }
}

// Deduped medicine names currently scheduled for a profile — feeds the safety layer's
// "currentMedicines" context alongside the profile's manually-entered otherMedicines.
export async function getScheduledMedicineNames(profileId) {
  const schedules = await getAllSchedules(profileId);
  return [...new Set(schedules.map(s => s.medicineName).filter(Boolean))];
}

// Update a schedule (mirrors to the cloud when signed in — server copy is source of truth).
export async function updateSchedule(id, updates) {
  try {
    const schedules = await readAll();
    const idx = schedules.findIndex(s => s.id === id);
    if (idx === -1) throw new Error('Schedule not found');

    if (await isLoggedIn()) {
      const { schedule } = await authFetch(`/api/schedules/${id}`, { method: 'PUT', body: JSON.stringify(updates) });
      schedules[idx] = { ...schedules[idx], ...schedule };
    } else {
      schedules[idx] = { ...schedules[idx], ...updates };
    }
    await writeAll(schedules);
    return schedules[idx];
  } catch (err) {
    console.error('[scheduleService] Error updating schedule:', err);
    throw err;
  }
}

// Delete a schedule (cloud first when signed in, then the local cache).
export async function deleteSchedule(id) {
  try {
    if (await isLoggedIn()) {
      // 404 just means it never reached the cloud (e.g. guest-era record) — still delete locally.
      await authFetch(`/api/schedules/${id}`, { method: 'DELETE' }).catch(err => {
        if (!/not found/i.test(err.message)) throw err;
      });
    }
    const schedules = await readAll();
    await writeAll(schedules.filter(s => s.id !== id));
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
