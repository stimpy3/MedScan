// app/pages/authPage.jsx
// Sign in / create account. Optional — the whole app works as a guest; an account just backs
// up profiles + reminders to the cloud (guest data is merged up automatically on first sign-in).
import { useRouter } from 'expo-router';
import { ArrowLeft, CloudUpload, Lock, Mail } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import HardShadow from '../../components/HardShadow';
import { signInAndMerge } from '../services/syncService';

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

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) { setError('Please fill in both fields'); return; }
    setBusy(true);
    setError(null);
    try {
      await signInAndMerge(mode, email.trim(), password);
      router.back();
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const isLogin = mode === 'login';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 52 }}>

        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16, borderBottomWidth: 1.5, borderBottomColor: C.border, marginBottom: 24 }}>
          <HardShadow offset={2}>
            <TouchableOpacity
              style={{ padding: 8, backgroundColor: C.blue, borderWidth: 1.5, borderColor: C.border, borderRadius: 4 }}
              onPress={() => router.back()}
            >
              <ArrowLeft size={20} color="#ffffff" />
            </TouchableOpacity>
          </HardShadow>
          <Text style={{ fontSize: 17, fontWeight: '900', color: C.dark }}>{isLogin ? 'Sign In' : 'Create Account'}</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Why an account */}
          <HardShadow style={{ width: '100%', marginBottom: 24 }}>
            <View style={{ flexDirection: 'row', gap: 10, backgroundColor: C.surface, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, padding: 14, alignItems: 'flex-start' }}>
              <CloudUpload size={18} color={C.purple} style={{ marginTop: 1 }} />
              <Text style={{ flex: 1, fontSize: 12, fontWeight: '600', color: C.dark, lineHeight: 18 }}>
                An account backs up your family profiles and reminders to the cloud. Everything on this device is merged into your account when you sign in.
              </Text>
            </View>
          </HardShadow>

          {/* Mode switch */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 22 }}>
            {[{ key: 'login', label: 'Sign In' }, { key: 'signup', label: 'New Account' }].map(({ key, label }) => {
              const on = mode === key;
              return (
                <TouchableOpacity
                  key={key}
                  activeOpacity={0.85}
                  onPress={() => { setMode(key); setError(null); }}
                  style={{ flex: 1, paddingVertical: 11, borderRadius: 4, alignItems: 'center', borderWidth: 1.5, borderColor: C.border, backgroundColor: on ? C.blue : C.card, ...(on ? BTN_SHADOW : {}) }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '800', color: on ? '#fff' : C.meta }}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Email */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Mail size={13} color={C.meta} strokeWidth={2.5} />
            <Text style={{ fontSize: 11, fontWeight: '800', color: C.meta, letterSpacing: 1, textTransform: 'uppercase' }}>Email</Text>
          </View>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#b8b0a0"
            autoCapitalize="none"
            keyboardType="email-address"
            style={{ fontSize: 15, fontWeight: '700', color: C.dark, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 18 }}
          />

          {/* Password */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Lock size={13} color={C.meta} strokeWidth={2.5} />
            <Text style={{ fontSize: 11, fontWeight: '800', color: C.meta, letterSpacing: 1, textTransform: 'uppercase' }}>Password</Text>
          </View>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder={isLogin ? 'Your password' : 'At least 6 characters'}
            placeholderTextColor="#b8b0a0"
            secureTextEntry
            style={{ fontSize: 15, fontWeight: '700', color: C.dark, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 18 }}
          />

          {error ? (
            <View style={{ backgroundColor: '#ffe0e0', borderRadius: 4, borderWidth: 1.5, borderColor: C.border, padding: 12, marginBottom: 18 }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: C.danger }}>{error}</Text>
            </View>
          ) : null}

          <HardShadow>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={submit}
              disabled={busy}
              style={{ backgroundColor: C.purple, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, paddingVertical: 15, alignItems: 'center', opacity: busy ? 0.7 : 1 }}
            >
              <Text style={{ fontSize: 15, fontWeight: '900', color: '#fff', letterSpacing: 0.5 }}>
                {busy ? 'Please wait…' : isLogin ? 'Sign In' : 'Create Account'}
              </Text>
            </TouchableOpacity>
          </HardShadow>

        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
