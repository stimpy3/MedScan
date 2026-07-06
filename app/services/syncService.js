// app/services/syncService.js
// Guest↔account sync orchestration.
//   signInAndMerge  — authenticate, upload the local guest document once, then adopt the
//                     server's merged state (server ids) as the new local cache.
//   pullRemote      — refresh the local cache from the server; silently a no-op when guest
//                     or offline, so reminders always render from the last-known cache.
//   signOut         — drop the token only; the local cache stays, so the device keeps
//                     working as a guest with the last-synced data.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authenticate, authFetch, clearSession, isLoggedIn } from './authService';

const PROFILES_KEY = 'medscan_profiles_v1';
const SCHEDULE_KEY = 'medscan_scheduled_medicines';

async function writeCache({ activeProfileId, profiles, schedules }) {
  const writes = [[PROFILES_KEY, JSON.stringify({ activeProfileId, profiles })]];
  if (schedules) writes.push([SCHEDULE_KEY, JSON.stringify(schedules)]);
  await AsyncStorage.multiSet(writes);
}

export async function signInAndMerge(mode, email, password) {
  const account = await authenticate(mode, email, password);
  try {
    const [profilesRaw, schedulesRaw] = (await AsyncStorage.multiGet([PROFILES_KEY, SCHEDULE_KEY])).map(r => r[1]);
    const local = profilesRaw ? JSON.parse(profilesRaw) : { activeProfileId: null, profiles: [] };
    const schedules = schedulesRaw ? JSON.parse(schedulesRaw) : [];
    const merged = await authFetch('/api/sync/merge', {
      method: 'POST',
      body: JSON.stringify({ activeProfileId: local.activeProfileId, profiles: local.profiles, schedules })
    });
    await writeCache(merged);
  } catch (err) {
    // The account session is valid even if the merge hiccuped — the next pull will reconcile.
    console.error('[sync] merge after sign-in failed:', err.message);
  }
  return account;
}

export async function pullRemote() {
  if (!(await isLoggedIn())) return false;
  try {
    const [profState, schedState] = await Promise.all([
      authFetch('/api/profiles'),
      authFetch('/api/schedules')
    ]);
    await writeCache({
      activeProfileId: profState.activeProfileId,
      profiles: profState.profiles,
      schedules: schedState.schedules
    });
    return true;
  } catch (err) {
    console.log('[sync] pull skipped:', err.message);
    return false;
  }
}

export async function signOut() {
  await clearSession();
}
