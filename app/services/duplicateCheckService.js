// app/services/duplicateCheckService.js
// Duplicate-therapy check against the server's ATC data. Stateless and unauthenticated on
// purpose — guest mode keeps schedules only in AsyncStorage, so the client always sends the
// names it has. Fail-open everywhere: a network error must never block scheduling.
import { getApiBaseUrl } from './ocrService';
import { getScheduledMedicineNames } from './scheduleService';

// names → groups of medicines sharing an ingredient or a therapeutic class.
// [{ kind: 'same_ingredient'|'same_class', friendlyLabel, className, medicines: [names] }]
export async function checkDuplicateGroups(names) {
  const list = [...new Set((names || []).map(n => String(n || '').trim()).filter(Boolean))];
  if (list.length < 2) return [];
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/schedules/check-duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ medicines: list })
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data.groups) ? data.groups : [];
  } catch {
    return [];
  }
}

// Creation-time check: does medicineName duplicate anything already scheduled for this profile?
// Returns only the groups involving the candidate. The exact-name case is caught locally —
// the server de-duplicates identical names, so it can't see "already scheduled as-is".
export async function checkBeforeSchedule(medicineName, profileId = null) {
  const name = String(medicineName || '').trim();
  if (!name) return [];
  let existing = [];
  try {
    existing = await getScheduledMedicineNames(profileId);
  } catch {
    return [];
  }
  if (!existing.length) return [];

  if (existing.some(n => String(n).toLowerCase() === name.toLowerCase())) {
    return [{ kind: 'already_scheduled', friendlyLabel: null, className: null, medicines: [name] }];
  }

  const groups = await checkDuplicateGroups([name, ...existing]);
  return groups.filter(g => (g.medicines || []).some(n => String(n).toLowerCase() === name.toLowerCase()));
}
