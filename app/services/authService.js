// app/services/authService.js
// Account session for the optional cloud layer. Guest mode = no token = none of this runs.
// Token + account live in AsyncStorage; every authenticated call goes through authFetch,
// which clears the session automatically if the server says the token is no longer valid.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiBaseUrl } from './ocrService';

const TOKEN_KEY = 'medscan_auth_token';
const ACCOUNT_KEY = 'medscan_auth_account';

let cachedToken; // undefined = not read yet, null = signed out

export async function getToken() {
  if (cachedToken === undefined) cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
  return cachedToken;
}

export async function isLoggedIn() {
  return !!(await getToken());
}

export async function getAccount() {
  try {
    const data = await AsyncStorage.getItem(ACCOUNT_KEY);
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

export async function clearSession() {
  cachedToken = null;
  await AsyncStorage.multiRemove([TOKEN_KEY, ACCOUNT_KEY]);
}

// mode: "signup" | "login". Stores the session on success, throws a readable Error otherwise.
export async function authenticate(mode, email, password) {
  const res = await fetch(`${getApiBaseUrl()}/api/auth/${mode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Could not ${mode === 'signup' ? 'create account' : 'sign in'}`);
  cachedToken = data.token;
  await AsyncStorage.multiSet([[TOKEN_KEY, data.token], [ACCOUNT_KEY, JSON.stringify(data.account)]]);
  return data.account;
}

// Authenticated JSON fetch. Throws when signed out, offline, or the server errors.
export async function authFetch(path, options = {}) {
  const token = await getToken();
  if (!token) throw new Error('Not signed in');
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  if (res.status === 401) {
    await clearSession();
    throw new Error('Session expired — please sign in again');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
