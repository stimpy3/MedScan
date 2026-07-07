// app/pages/profilePage.jsx
// Manage local health profiles ("Me", "Mom", ...) that power the personalized safety layer.
// Netflix-style: one switcher row up top, one editable form below for whichever profile is active.
// Visual language matches home/auth: warm paper bg + dot grain, hard-shadow white cards,
// per-profile accent colors on the avatar switcher.
import * as Haptics from 'expo-haptics';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, Baby, CloudUpload, HeartPulse, LogOut, Plus, Trash2, User, UserRound, Wine } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import HardShadow from '../../components/HardShadow';
import ChipInput from '../../components/ChipInput';
import DotTexture from '../../components/DotTexture';
import { ProfileSkeleton } from '../../components/Skeletons';
import { StarSticker } from '../../components/Stickers';
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
  bg:      '#f7f4ec',   // warm paper — same as the home screen
  surface: '#ede8d8',
  card:    '#ffffff',
  field:   '#f7f4ec',
  border:  '#2a2a2a',
  blue:    '#2198a8',
  purple:  '#6b5390',
  ochre:   '#9f9065',
  coral:   '#e07a5f',
  dark:    '#2a2a2a',
  meta:    '#8a7850',
  danger:  '#e53e3e',
};

// Each family member gets their own accent, cycling through the app palette.
const PROFILE_COLORS = [C.blue, C.purple, C.ochre, C.coral];

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

// White card with hard shadow + colored icon square header — same treatment as home's feature cards.
const SectionCard = ({ icon: Icon, iconColor, title, children }) => (
  <HardShadow offset={3} style={{ width: '100%', marginBottom: 18 }}>
    <View style={{ backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, padding: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <View style={{ width: 32, height: 32, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: iconColor, alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={16} color="#ffffff" strokeWidth={2.5} />
        </View>
        <Text style={{ fontSize: 15, fontWeight: '900', color: C.dark }}>{title}</Text>
      </View>
      {children}
    </View>
  </HardShadow>
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
    router.replace('/pages/authPage');
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
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <DotTexture opacity={0.16} />
        <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 52 }}>
          <ProfileSkeleton />
        </View>
      </View>
    );
  }

  const showPregnancy = draft.gender === 'female';
  const activeIndex = Math.max(0, profiles.findIndex(p => p.id === activeId));
  const activeColor = PROFILE_COLORS[activeIndex % PROFILE_COLORS.length];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <DotTexture opacity={0.16} />
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 52 }}>

        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16, borderBottomWidth: 1.5, borderBottomColor: C.border, marginBottom: 20 }}>
          <HardShadow offset={2}>
            <TouchableOpacity
              style={{ padding: 8, backgroundColor: C.blue, borderWidth: 1.5, borderColor: C.border, borderRadius: 4 }}
              onPress={() => router.back()}
            >
              <ArrowLeft size={20} color="#ffffff" />
            </TouchableOpacity>
          </HardShadow>
          {/* rotated sticker-badge title, like the auth screen's "YOUR MEDICINE BUDDY" */}
          <View style={{ transform: [{ rotate: '-2deg' }], ...BTN_SHADOW }}>
            <View style={{ backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 14, paddingVertical: 6 }}>
              <Text style={{ fontSize: 13, fontWeight: '900', color: C.dark, letterSpacing: 1.5 }}>FAMILY PROFILES</Text>
            </View>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

          {/* Profile switcher — avatar tiles, one accent color per member */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 6, paddingRight: 8 }} style={{ marginBottom: 6 }}>
            {profiles.map((p, i) => {
              const on = p.id === activeId;
              const color = PROFILE_COLORS[i % PROFILE_COLORS.length];
              const initial = p.label?.trim() ? p.label.trim()[0].toUpperCase() : null;
              return (
                <TouchableOpacity key={p.id} activeOpacity={0.85} onPress={() => switchTo(p.id)} style={{ alignItems: 'center', width: 64 }}>
                  <View>
                    <HardShadow offset={on ? 3 : 2} borderRadius={28}>
                      <View style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: C.border, backgroundColor: on ? color : C.card, alignItems: 'center', justifyContent: 'center' }}>
                        {initial ? (
                          <Text style={{ fontSize: 22, fontWeight: '900', color: on ? '#ffffff' : color }}>{initial}</Text>
                        ) : (
                          <UserRound size={22} color={on ? '#ffffff' : color} />
                        )}
                      </View>
                    </HardShadow>
                    {on && (
                      <View pointerEvents="none" style={{ position: 'absolute', top: -8, right: -4, zIndex: 10, elevation: 10 }}>
                        <StarSticker size={22} fill={C.ochre} />
                      </View>
                    )}
                  </View>
                  <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: on ? '900' : '700', color: on ? C.dark : C.meta, marginTop: 6 }}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {/* add member — dashed ghost tile */}
            <TouchableOpacity activeOpacity={0.85} onPress={handleAddProfile} style={{ alignItems: 'center', width: 64 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.meta, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Plus size={22} color={C.meta} strokeWidth={2.5} />
              </View>
              <Text style={{ fontSize: 11, fontWeight: '700', color: C.meta, marginTop: 6 }}>Add</Text>
            </TouchableOpacity>
          </ScrollView>

          {/* Account — optional cloud backup. Guests see a sign-in nudge, members see their email. */}
          <HardShadow offset={3} style={{ width: '100%', marginVertical: 18 }}>
            {account ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 12, gap: 10 }}>
                <View style={{ width: 32, height: 32, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' }}>
                  <CloudUpload size={16} color="#ffffff" strokeWidth={2.5} />
                </View>
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

          {/* ── About card: name, relation, age, gender, pregnancy ── */}
          <SectionCard icon={User} iconColor={activeColor} title={`About ${draft.label?.trim() || 'this member'}`}>
            <SectionLabel>Name</SectionLabel>
            <TextInput
              value={draft.label}
              onChangeText={(v) => patchDraft({ label: v })}
              placeholder="e.g. Mom"
              placeholderTextColor="#b8b0a0"
              style={{ fontSize: 15, fontWeight: '800', color: C.dark, backgroundColor: C.field, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 16 }}
            />

            <SectionLabel>Relation</SectionLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              {RELATIONS.map(r => {
                const on = draft.relation === r;
                return (
                  <TouchableOpacity
                    key={r}
                    activeOpacity={0.8}
                    onPress={() => { tick(); patchDraft({ relation: r }); }}
                    style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, backgroundColor: on ? C.blue : C.field, ...(on ? BTN_SHADOW : {}) }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '800', color: on ? '#fff' : C.meta }}>{RELATION_LABELS[r]}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <SectionLabel>Age (years)</SectionLabel>
            <TextInput
              value={draft.ageYears != null ? String(draft.ageYears) : ''}
              onChangeText={(v) => patchDraft({ ageYears: v ? parseInt(v.replace(/[^0-9]/g, ''), 10) : null })}
              placeholder="Optional"
              placeholderTextColor="#b8b0a0"
              keyboardType="number-pad"
              style={{ fontSize: 15, fontWeight: '700', color: C.dark, backgroundColor: C.field, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 16 }}
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
                    style={{ flex: 1, paddingVertical: 11, borderRadius: 4, alignItems: 'center', borderWidth: 1.5, borderColor: C.border, backgroundColor: on ? C.blue : C.field, ...(on ? BTN_SHADOW : {}) }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '800', color: on ? '#ffffff' : C.meta, textTransform: 'capitalize' }}>{g}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Pregnancy / breastfeeding — shown only when relevant */}
            {showPregnancy && (
              <View style={{ marginTop: 16 }}>
                <SectionLabel icon={Baby}>Pregnancy</SectionLabel>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {[{ key: 'pregnant', label: 'Pregnant' }, { key: 'breastfeeding', label: 'Breastfeeding' }].map(({ key, label }) => {
                    const on = !!draft[key];
                    return (
                      <TouchableOpacity
                        key={key}
                        activeOpacity={0.8}
                        onPress={() => { tick(); patchDraft({ [key]: !on }); }}
                        style={{ flex: 1, paddingVertical: 11, borderRadius: 4, alignItems: 'center', borderWidth: 1.5, borderColor: C.border, backgroundColor: on ? C.purple : C.field, ...(on ? BTN_SHADOW : {}) }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '800', color: on ? '#ffffff' : C.meta }}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}
          </SectionCard>

          {/* ── Health card: allergies, conditions, alcohol, other medicines ── */}
          <SectionCard icon={HeartPulse} iconColor={C.purple} title="Health details">
            <View style={{ marginBottom: 18 }}>
              <ChipInput
                label="Allergies"
                values={draft.allergies}
                onChange={(v) => patchDraft({ allergies: v })}
                placeholder="e.g. penicillin"
              />
            </View>

            <View style={{ marginBottom: 18 }}>
              <ChipInput
                label="Conditions"
                values={draft.conditions}
                onChange={(v) => patchDraft({ conditions: v })}
                quickPicks={CONDITION_QUICK_PICKS}
                placeholder="Add another condition"
              />
            </View>

            <View style={{ marginBottom: 18 }}>
              <SectionLabel icon={Wine}>Alcohol use</SectionLabel>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {ALCOHOL_OPTIONS.map(({ value, label }) => {
                  const on = (draft.alcohol || null) === value;
                  return (
                    <TouchableOpacity
                      key={label}
                      activeOpacity={0.8}
                      onPress={() => { tick(); patchDraft({ alcohol: value }); }}
                      style={{ flex: 1, paddingVertical: 11, borderRadius: 4, alignItems: 'center', borderWidth: 1.5, borderColor: C.border, backgroundColor: on ? C.blue : C.field, ...(on ? BTN_SHADOW : {}) }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '800', color: on ? '#ffffff' : C.meta }}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <ChipInput
              label="Other medicines"
              values={draft.otherMedicines}
              onChange={(v) => patchDraft({ otherMedicines: v })}
              placeholder="Medicines not in reminders"
            />
          </SectionCard>

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
