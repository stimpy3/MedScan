// app/services/profileService.js
// Local-first health profiles (Netflix-style: one device, multiple member profiles — "Me", "Mom",
// "Dad"...). Everything lives in AsyncStorage under one atomic document. No accounts yet — this
// is the guest-mode data layer; the shape is deliberately flat so a future account sync is just
// an upload/merge of this same document (see plan doc: idea-is-personalized-safety-shimmying-bubble).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { migrateSchedulesToProfile, reassignSchedules, getScheduledMedicineNames } from './scheduleService';
import { isLoggedIn, authFetch } from './authService';

const PROFILES_KEY = 'medscan_profiles_v1';

function generateId() {
  return `profile_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function defaultProfile(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    label: 'Me',
    relation: 'self',
    dob: null,
    ageYears: null,
    gender: null,
    pregnant: false,
    breastfeeding: false,
    allergies: [],
    conditions: [],
    alcohol: null,       // "none" | "occasional" | "regular"
    otherMedicines: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

async function readRaw() {
  try {
    const data = await AsyncStorage.getItem(PROFILES_KEY);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error('[profileService] Error reading profiles:', err);
    return null;
  }
}

async function writeRaw(state) {
  await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify(state));
  return state;
}

// Lazily creates the first "Me" profile on first-ever read, and stamps any pre-existing
// schedules (created before profiles existed) onto it. Idempotent — safe to call every time.
async function getProfilesState() {
  let state = await readRaw();
  if (!state || !Array.isArray(state.profiles) || state.profiles.length === 0) {
    const me = defaultProfile({ label: 'Me', relation: 'self' });
    state = { activeProfileId: me.id, profiles: [me] };
    await writeRaw(state);
    try {
      await migrateSchedulesToProfile(me.id);
    } catch (err) {
      console.error('[profileService] Schedule migration failed:', err);
    }
  } else if (!state.profiles.some(p => p.id === state.activeProfileId)) {
    // Active id points at a deleted profile — fall back to the first one.
    state.activeProfileId = state.profiles[0].id;
    await writeRaw(state);
  }
  return state;
}

async function getActiveProfile() {
  const { activeProfileId, profiles } = await getProfilesState();
  return profiles.find(p => p.id === activeProfileId) || null;
}

async function setActiveProfile(id) {
  const state = await getProfilesState();
  if (!state.profiles.some(p => p.id === id)) throw new Error('Profile not found');
  // Best-effort mirror: switching the active member is a view preference — if the server is
  // unreachable the local switch still happens and the next pull reconciles.
  if (await isLoggedIn()) {
    authFetch(`/api/profiles/active/${id}`, { method: 'PUT' }).catch(err =>
      console.log('[profileService] active-profile mirror skipped:', err.message));
  }
  state.activeProfileId = id;
  await writeRaw(state);
  return state;
}

async function createProfile(fields = {}) {
  const state = await getProfilesState();
  // Signed in → the server creates the record (its id becomes the local id, so future
  // mutations and safety-context hashes stay consistent across devices).
  if (await isLoggedIn()) {
    const { profile } = await authFetch('/api/profiles', { method: 'POST', body: JSON.stringify(defaultProfile(fields)) });
    await authFetch(`/api/profiles/active/${profile.id}`, { method: 'PUT' }).catch(() => {});
    state.profiles.push(profile);
    state.activeProfileId = profile.id;
    await writeRaw(state);
    return profile;
  }
  const profile = defaultProfile(fields);
  state.profiles.push(profile);
  state.activeProfileId = profile.id; // new profile becomes active, mirrors adding a Netflix member
  await writeRaw(state);
  return profile;
}

async function updateProfile(id, updates) {
  const state = await getProfilesState();
  const idx = state.profiles.findIndex(p => p.id === id);
  if (idx === -1) throw new Error('Profile not found');
  if (await isLoggedIn()) {
    const { profile } = await authFetch(`/api/profiles/${id}`, { method: 'PUT', body: JSON.stringify(updates) });
    state.profiles[idx] = { ...state.profiles[idx], ...profile };
    await writeRaw(state);
    return state.profiles[idx];
  }
  state.profiles[idx] = { ...state.profiles[idx], ...updates, id, updatedAt: new Date().toISOString() };
  await writeRaw(state);
  return state.profiles[idx];
}

async function deleteProfile(id) {
  const state = await getProfilesState();
  if (state.profiles.length <= 1) throw new Error('Cannot delete the only profile');
  // Server first (it reassigns that member's cloud schedules itself); local mirror after.
  if (await isLoggedIn()) {
    await authFetch(`/api/profiles/${id}`, { method: 'DELETE' });
  }
  state.profiles = state.profiles.filter(p => p.id !== id);
  if (state.activeProfileId === id) state.activeProfileId = state.profiles[0].id;
  await writeRaw(state);
  // Reassign that profile's schedules to whatever is now active, rather than orphaning them.
  try {
    await reassignSchedules(id, state.activeProfileId);
  } catch (err) {
    console.error('[profileService] Schedule reassignment failed:', err);
  }
  return state;
}

// True when NO safety-relevant field is set — the signal used everywhere to decide whether the
// safety layer has anything to check (empty profile = layer silently off, zero LLM cost).
function isProfileEmpty(profile) {
  if (!profile) return true;
  const listsEmpty = (profile.allergies || []).length === 0 && (profile.conditions || []).length === 0 && (profile.otherMedicines || []).length === 0;
  const flagsOff = !profile.pregnant && !profile.breastfeeding && !profile.alcohol;
  const noAge = profile.ageYears == null && !profile.dob;
  return listsEmpty && flagsOff && noAge;
}

function ageYearsOf(profile) {
  if (profile.ageYears != null) return profile.ageYears;
  if (profile.dob) {
    const dob = new Date(profile.dob);
    if (!isNaN(dob.getTime())) {
      const diff = Date.now() - dob.getTime();
      return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
    }
  }
  return null;
}

// Small deterministic hash (djb2) — good enough to detect "the safety-relevant facts changed",
// not for security. Changes when the profile OR the current medicine set changes, which is
// exactly when the server-side safety cache must miss.
function djb2(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

function computeProfileHash(profile, currentMedicineNames) {
  const canonical = {
    ageYears: ageYearsOf(profile),
    gender: profile.gender || null,
    pregnant: !!profile.pregnant,
    breastfeeding: !!profile.breastfeeding,
    alcohol: profile.alcohol || null,
    allergies: [...(profile.allergies || [])].map(a => a.toLowerCase()).sort(),
    conditions: [...(profile.conditions || [])].map(c => c.toLowerCase()).sort(),
    otherMedicines: [...(profile.otherMedicines || [])].map(m => m.toLowerCase()).sort(),
    currentMedicines: [...(currentMedicineNames || [])].map(m => m.toLowerCase()).sort()
  };
  return djb2(JSON.stringify(canonical));
}

// The one call site chatPage needs: null when there's nothing worth checking (profile empty AND
// no current medicines), otherwise the exact payload the server's safetyContext expects.
async function buildSafetyContext() {
  const profile = await getActiveProfile();
  if (!profile) return null;

  let scheduledNames = [];
  try {
    scheduledNames = await getScheduledMedicineNames(profile.id);
  } catch (err) {
    console.error('[profileService] Could not read scheduled medicines:', err);
  }
  const currentMedicines = [...new Set([...(profile.otherMedicines || []), ...scheduledNames])];

  if (isProfileEmpty(profile) && currentMedicines.length === 0) return null;

  return {
    profile: {
      label: profile.label,
      ageYears: ageYearsOf(profile),
      gender: profile.gender || null,
      pregnant: !!profile.pregnant,
      breastfeeding: !!profile.breastfeeding,
      allergies: profile.allergies || [],
      conditions: profile.conditions || [],
      alcohol: profile.alcohol || null
    },
    currentMedicines,
    profileHash: computeProfileHash(profile, currentMedicines)
  };
}

export {
  getProfilesState,
  getActiveProfile,
  setActiveProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  isProfileEmpty,
  computeProfileHash,
  buildSafetyContext
};
