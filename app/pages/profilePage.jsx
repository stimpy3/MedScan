// app/pages/profilePage.jsx
// Manage local health profiles ("Me", "Mom", ...) that power the personalized safety layer.
// Netflix-style: one switcher row up top, one editable form below for whichever profile is active.
import * as Haptics from 'expo-haptics';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, Baby, CloudUpload, LogOut, Plus, Trash2, User, Wine } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import HardShadow from '../../components/HardShadow';
import ChipInput from '../../components/ChipInput';
import {
  getProfilesState,
  createProfile,
  updateProfile,
  deleteProfile,
  setActiveProfile
} from '../services/profileService';
import { getAccount } from '../services/authService';
import { pullRemote, signOut } from '../services/syncService';

const C = {
  bg:      '#ffffff',
  surface: '#ede8d8',
  card:    '#ffffff',
  border:  '#2a2a2a',
  blue:    '#2198a8',
  purple:  '#6b5390',
  dark:    '#2a2a2a',
  meta:    '#8a7850',
  danger:  '#e53e3e',
};

const BTN_SHADOW = {
  shadowColor: '#2a2a2a',
  shadowOffset: { width: 2, height: 2 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 3,
};

const RELATIONS = ['self', 'mother', 'father', 'spouse', 'child', 'other'];
const RELATION_LABELS = { self: 'Me', mother: 'Mother', father: 'Father', spouse: 'Spouse', child: 'Child', other: 'Other' };
const CONDITION_QUICK_PICKS = ['Diabetes', 'Hypertension', 'Asthma', 'Kidney disease', 'Liver disease', 'Heart disease', 'Thyroid'];
const ALCOHOL_OPTIONS = [
  { value: null, label: 'None' },
  { value: 'occasional', label: 'Occasional' },
  { value: 'regular', label: 'Regular' }
];

function tick() {
  try { Haptics.selectionAsync(); } catch { /* no-op on web */ }
}

const SectionLabel = ({ icon: Icon, children }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
    {Icon ? <Icon size={13} color={C.meta} strokeWidth={2.5} /> : null}
    <Text style={{ fontSize: 11, fontWeight: '800', color: C.meta, letterSpacing: 1, textTransform: 'uppercase' }}>
      {children}
    </Text>
  </View>
);

export default function ProfilePage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState(null); // the profile currently being edited (local form state)
  const [saving, setSaving] = useState(false);
  const [account, setAccount] = useState(null); // { email } when signed in, null for guests

  const load = useCallback(async () => {
    const state = await getProfilesState();
    setProfiles(state.profiles);
    setActiveId(state.activeProfileId);
    const active = state.profiles.find(p => p.id === state.activeProfileId);
    setDraft(active ? { ...active } : null);
    setAccount(await getAccount());
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    // Signed in → refresh the cache from the cloud in the background, then re-render.
    pullRemote().then(pulled => { if (pulled) load(); });
  }, [load]));

  const handleSignOut = async () => {
    await signOut();
    await load();
  };

  const switchTo = async (id) => {
    if (id === activeId) return;
    tick();
    await setActiveProfile(id);
    await load();
  };

  const handleAddProfile = async () => {
    tick();
    const created = await createProfile({ label: `Member ${profiles.length + 1}`, relation: 'other' });
    await load();
    setActiveId(created.id);
  };

  const handleDelete = async () => {
    if (profiles.length <= 1) { alert('You need at least one profile.'); return; }
    try {
      await deleteProfile(activeId);
      await load();
    } catch (err) {
      alert(err.message || 'Could not delete profile');
    }
  };

  const patchDraft = (updates) => setDraft(prev => ({ ...prev, ...updates }));

  const handleSave = async () => {
    if (!draft.label.trim()) { alert('Please enter a name'); return; }
    setSaving(true);
    try {
      await updateProfile(draft.id, draft);
      await load();
    } catch (err) {
      console.error('[ProfilePage] Save failed:', err);
      alert('Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  }

  const showPregnancy = draft.gender === 'female';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 52 }}>

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
          <Text style={{ fontSize: 17, fontWeight: '900', color: C.dark }}>Profiles</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

          {/* Account — optional cloud backup. Guests see a sign-in nudge, members see their email. */}
          <HardShadow style={{ width: '100%', marginBottom: 20 }}>
            {account ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 12, gap: 10 }}>
                <CloudUpload size={16} color={C.purple} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: C.meta, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 }}>Synced to</Text>
                  <Text style={{ fontSize: 13, fontWeight: '800', color: C.dark }} numberOfLines={1}>{account.email}</Text>
                </View>
                <TouchableOpacity
                  onPress={handleSignOut}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: '#ffe0e0' }}
                >
                  <LogOut size={13} color={C.danger} />
                  <Text style={{ fontSize: 11, fontWeight: '900', color: C.danger }}>Sign Out</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => router.push('/pages/authPage')}
                style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.purple, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 13, gap: 10 }}
              >
                <CloudUpload size={16} color="#ffffff" />
                <Text style={{ flex: 1, fontSize: 13, fontWeight: '800', color: '#ffffff' }}>Sign in to back up & sync profiles</Text>
              </TouchableOpacity>
            )}
          </HardShadow>

          {/* Profile switcher */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }} style={{ marginBottom: 20 }}>
            {profiles.map(p => {
              const on = p.id === activeId;
              return (
                <TouchableOpacity
                  key={p.id}
                  activeOpacity={0.85}
                  onPress={() => switchTo(p.id)}
                  style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: on ? C.blue : C.surface, ...(on ? BTN_SHADOW : {}) }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '800', color: on ? '#fff' : C.dark }}>{p.label}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleAddProfile}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface }}
            >
              <Plus size={14} color={C.dark} strokeWidth={2.5} />
              <Text style={{ fontSize: 13, fontWeight: '800', color: C.dark }}>Add</Text>
            </TouchableOpacity>
          </ScrollView>

          {/* Basics */}
          <View style={{ marginBottom: 22 }}>
            <SectionLabel icon={User}>Name</SectionLabel>
            <TextInput
              value={draft.label}
              onChangeText={(v) => patchDraft({ label: v })}
              placeholder="e.g. Mom"
              placeholderTextColor="#b8b0a0"
              style={{ fontSize: 15, fontWeight: '800', color: C.dark, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 12 }}
            />
            <SectionLabel>Relation</SectionLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {RELATIONS.map(r => {
                const on = draft.relation === r;
                return (
                  <TouchableOpacity
                    key={r}
                    activeOpacity={0.8}
                    onPress={() => { tick(); patchDraft({ relation: r }); }}
                    style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: on ? C.blue : C.card, ...(on ? BTN_SHADOW : {}) }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '800', color: on ? '#fff' : C.meta }}>{RELATION_LABELS[r]}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Age + gender */}
          <View style={{ marginBottom: 22 }}>
            <SectionLabel>Age (years)</SectionLabel>
            <TextInput
              value={draft.ageYears != null ? String(draft.ageYears) : ''}
              onChangeText={(v) => patchDraft({ ageYears: v ? parseInt(v.replace(/[^0-9]/g, ''), 10) : null })}
              placeholder="Optional"
              placeholderTextColor="#b8b0a0"
              keyboardType="number-pad"
              style={{ fontSize: 15, fontWeight: '700', color: C.dark, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 12 }}
            />
            <SectionLabel>Gender</SectionLabel>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {['female', 'male', 'other'].map(g => {
                const on = draft.gender === g;
                return (
                  <TouchableOpacity
                    key={g}
                    activeOpacity={0.8}
                    onPress={() => { tick(); patchDraft({ gender: g, ...(g !== 'female' ? { pregnant: false, breastfeeding: false } : {}) }); }}
                    style={{ flex: 1, paddingVertical: 11, borderRadius: 4, alignItems: 'center', borderWidth: 1.5, borderColor: C.border, backgroundColor: on ? C.blue : C.card, ...(on ? BTN_SHADOW : {}) }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '800', color: on ? '#ffffff' : C.meta, textTransform: 'capitalize' }}>{g}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Pregnancy / breastfeeding — shown only when relevant */}
          {showPregnancy && (
            <View style={{ marginBottom: 22 }}>
              <SectionLabel icon={Baby}>Pregnancy</SectionLabel>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[{ key: 'pregnant', label: 'Pregnant' }, { key: 'breastfeeding', label: 'Breastfeeding' }].map(({ key, label }) => {
                  const on = !!draft[key];
                  return (
                    <TouchableOpacity
                      key={key}
                      activeOpacity={0.8}
                      onPress={() => { tick(); patchDraft({ [key]: !on }); }}
                      style={{ flex: 1, paddingVertical: 11, borderRadius: 4, alignItems: 'center', borderWidth: 1.5, borderColor: C.border, backgroundColor: on ? C.purple : C.card, ...(on ? BTN_SHADOW : {}) }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '800', color: on ? '#ffffff' : C.meta }}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Allergies */}
          <View style={{ marginBottom: 22 }}>
            <ChipInput
              label="Allergies"
              values={draft.allergies}
              onChange={(v) => patchDraft({ allergies: v })}
              placeholder="e.g. penicillin"
            />
          </View>

          {/* Conditions */}
          <View style={{ marginBottom: 22 }}>
            <ChipInput
              label="Conditions"
              values={draft.conditions}
              onChange={(v) => patchDraft({ conditions: v })}
              quickPicks={CONDITION_QUICK_PICKS}
              placeholder="Add another condition"
            />
          </View>

          {/* Alcohol */}
          <View style={{ marginBottom: 22 }}>
            <SectionLabel icon={Wine}>Alcohol use</SectionLabel>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {ALCOHOL_OPTIONS.map(({ value, label }) => {
                const on = (draft.alcohol || null) === value;
                return (
                  <TouchableOpacity
                    key={label}
                    activeOpacity={0.8}
                    onPress={() => { tick(); patchDraft({ alcohol: value }); }}
                    style={{ flex: 1, paddingVertical: 11, borderRadius: 4, alignItems: 'center', borderWidth: 1.5, borderColor: C.border, backgroundColor: on ? C.blue : C.card, ...(on ? BTN_SHADOW : {}) }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '800', color: on ? '#ffffff' : C.meta }}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Other medicines */}
          <View style={{ marginBottom: 26 }}>
            <ChipInput
              label="Other medicines"
              values={draft.otherMedicines}
              onChange={(v) => patchDraft({ otherMedicines: v })}
              placeholder="Medicines not in reminders"
            />
          </View>

          {/* Save */}
          <HardShadow style={{ marginBottom: 12 }}>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={handleSave}
              disabled={saving}
              style={{ backgroundColor: C.blue, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, paddingVertical: 15, alignItems: 'center', opacity: saving ? 0.7 : 1 }}
            >
              <Text style={{ fontSize: 15, fontWeight: '900', color: '#fff', letterSpacing: 0.5 }}>
                {saving ? 'Saving…' : 'Save Profile'}
              </Text>
            </TouchableOpacity>
          </HardShadow>

          {/* Delete (only when more than one profile exists) */}
          {profiles.length > 1 && (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleDelete}
              style={{ flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: '#ffe0e0' }}
            >
              <Trash2 size={15} color={C.danger} />
              <Text style={{ fontSize: 13, fontWeight: '900', color: C.danger }}>Delete This Profile</Text>
            </TouchableOpacity>
          )}

        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
