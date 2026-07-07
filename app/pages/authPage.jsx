// app/pages/authPage.jsx
// Welcome + sign-in screen. Shown on first launch (via app/index.jsx) and from the profile
// page. Full neo-brutalist treatment: pill mascot, floating geometric stickers, marquee
// ticker — all drawn with react-native-svg and animated with the built-in Animated API.
// Accounts are optional: "Continue without an account" keeps everything on-device.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { AlertTriangle, ArrowLeft, ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import HardShadow from '../../components/HardShadow';
import { CircleSticker, PillMascot, PlusSticker, StarSticker } from '../../components/Stickers';
import { signInAndMerge } from '../services/syncService';

export const WELCOME_DONE_KEY = 'medscan_welcome_done';

const C = {
  bg:      '#ede8d8',
  field:   '#f7f4ec',  // input fill: same warm family as bg, but much closer to white
  card:    '#ffffff',
  border:  '#2a2a2a',
  blue:    '#2198a8',
  purple:  '#6b5390',
  ochre:   '#9f9065',
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

// ── Animation helpers ─────────────────────────────────────────────────────────────────────────

// Endless up-down bob. Every decor element gets its own duration/delay so they drift out of phase.
function useBob(duration = 2200, delay = 0) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v, duration, delay]);
  return v;
}

// One-shot pop-in (scale + fade) for the entrance.
function usePopIn(delay = 0) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(v, { toValue: 1, delay, friction: 6, tension: 60, useNativeDriver: true }).start();
  }, [v, delay]);
  return v;
}

// A floating decor wrapper: absolute position + bob + optional rotation.
// (The SVG characters themselves live in components/Stickers.jsx, shared with the home page.)
function Floaty({ style, duration, delay, rotate = '0deg', children }) {
  const bob = useBob(duration, delay);
  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [-5, 5] });
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', transform: [{ translateY }, { rotate }] }, style]}>
      {children}
    </Animated.View>
  );
}

// ── Marquee ticker: "SCAN · EXPLAIN · COMPARE · REMIND" scrolling forever ─────────────────────
const TICKER_WORDS = 'SCAN · EXPLAIN · COMPARE · CHECK SAFETY · REMIND · ';
function Marquee() {
  const x = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!w) return;
    x.setValue(0);
    const loop = Animated.loop(
      Animated.timing(x, { toValue: -w, duration: w * 30, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [w, x]);
  const textStyle = { fontSize: 12, fontWeight: '900', color: '#ffffff', letterSpacing: 2 };
  return (
    <View style={{ backgroundColor: C.purple, borderTopWidth: 1.5, borderBottomWidth: 1.5, borderColor: C.border, paddingVertical: 8, overflow: 'hidden', flexDirection: 'row' }}>
      <Animated.View style={{ flexDirection: 'row', transform: [{ translateX: x }] }}>
        <Text numberOfLines={1} onLayout={(e) => setW(e.nativeEvent.layout.width)} style={textStyle}>{TICKER_WORDS}</Text>
        <Text numberOfLines={1} style={textStyle}>{TICKER_WORDS}</Text>
        <Text numberOfLines={1} style={textStyle}>{TICKER_WORDS}</Text>
      </Animated.View>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────────────────────
// asWelcome: rendered as the first-launch gate (no back button; finishing notifies the gate).
// Route-rendered (from profile page) gets defaults: back button + router.back() on finish.
export default function AuthPage({ asWelcome = false, onDone }) {
  const router = useRouter();
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState(null); // 'email' | 'password' | null

  // Android + edgeToEdgeEnabled ignores adjustResize, so the keyboard overlays the screen and
  // KeyboardAvoidingView never kicks in. Track the keyboard height ourselves (Android only —
  // iOS is handled by the KeyboardAvoidingView) and scroll the form into view on focus.
  const scrollRef = useRef(null);
  const formY = useRef(0);
  const [kbHeight, setKbHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKbHeight(e.endCoordinates?.height || 0));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const focusField = (name) => {
    setFocused(name);
    // Bring the form section to the top of the screen, clear of the keyboard.
    setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, formY.current - 8), animated: true }), 120);
  };

  const heroPop = usePopIn(80);
  const cardPop = usePopIn(240);
  const mascotBob = useBob(2400);
  const mascotTilt = mascotBob.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '3deg'] });

  const finish = async () => {
    try { await AsyncStorage.setItem(WELCOME_DONE_KEY, '1'); } catch { /* non-fatal */ }
    if (onDone) onDone();
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const submit = async () => {
    if (!email.trim() || !password) { setError('Please fill in both fields'); return; }
    setBusy(true);
    setError(null);
    try {
      await signInAndMerge(mode, email.trim(), password);
      await finish();
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const isLogin = mode === 'login';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingBottom: kbHeight }}
      >

        {/* ── Hero ── */}
        <View style={{ paddingTop: 54, paddingHorizontal: 20 }}>
          {!asWelcome && (
            <HardShadow offset={2} style={{ alignSelf: 'flex-start', marginBottom: 4 }}>
              <TouchableOpacity
                style={{ padding: 8, backgroundColor: C.blue, borderWidth: 1.5, borderColor: C.border, borderRadius: 4 }}
                onPress={() => router.back()}
              >
                <ArrowLeft size={20} color="#ffffff" />
              </TouchableOpacity>
            </HardShadow>
          )}

          <Animated.View style={{ alignItems: 'center', paddingTop: 6, paddingBottom: 18, opacity: heroPop, transform: [{ scale: heroPop.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }}>

            {/* floating stickers around the mascot */}
            <View style={{ width: 260, height: 180, alignItems: 'center', justifyContent: 'center' }}>
              <Floaty style={{ top: 6, left: 18 }} duration={2600} delay={200} rotate="-12deg"><StarSticker size={36} fill={C.purple} /></Floaty>
              <Floaty style={{ top: 66, left: 0 }} duration={2100} delay={700} rotate="8deg"><PlusSticker size={28} fill={C.ochre} /></Floaty>
              <Floaty style={{ top: 0, right: 30 }} duration={2300} delay={450}><CircleSticker size={22} fill={C.blue} /></Floaty>
              <Floaty style={{ top: 84, right: 6 }} duration={2700} delay={100} rotate="14deg"><StarSticker size={24} fill={C.blue} /></Floaty>
              <Floaty style={{ bottom: 0, right: 52 }} duration={2000} delay={900} rotate="-6deg"><PlusSticker size={20} fill={C.purple} /></Floaty>

              <Animated.View style={{ transform: [{ translateY: mascotBob.interpolate({ inputRange: [0, 1], outputRange: [-6, 6] }) }, { rotate: mascotTilt }] }}>
                <PillMascot size={116} />
              </Animated.View>
            </View>

            {/* rotated sticker badge */}
            <View style={{ transform: [{ rotate: '-3deg' }], marginTop: 2, marginBottom: 10, ...BTN_SHADOW }}>
              <View style={{ backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 5 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: C.dark, letterSpacing: 2 }}>YOUR MEDICINE BUDDY</Text>
              </View>
            </View>

            <Text style={{ fontSize: 40, fontWeight: '900', color: C.dark, letterSpacing: -1 }}>
              Med<Text style={{ color: C.blue }}>Scan</Text>
            </Text>
            <Text style={{ fontSize: 12, fontWeight: '700', color: C.meta, marginTop: 2 }}>
              Scan, understand & remember your medicines
            </Text>
          </Animated.View>
        </View>

        <Marquee />

        {/* ── Auth section: full-bleed white below the banner, no card container ── */}
        <View
          onLayout={(e) => { formY.current = e.nativeEvent.layout.y; }}
          style={{ flex: 1, backgroundColor: '#ffffff', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 }}
        >
          <Animated.View style={{ opacity: cardPop, transform: [{ translateY: cardPop.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }}>

            {/* mode toggle — joined segmented control */}
            <HardShadow offset={3} style={{ width: '100%', marginBottom: 22 }}>
              <View style={{ flexDirection: 'row', borderWidth: 1.5, borderColor: C.border, borderRadius: 4, overflow: 'hidden', backgroundColor: C.bg }}>
                {[{ key: 'login', label: 'Sign In' }, { key: 'signup', label: 'New Account' }].map(({ key, label }, i) => {
                  const on = mode === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      activeOpacity={0.85}
                      onPress={() => { setMode(key); setError(null); }}
                      style={{ flex: 1, paddingVertical: 13, alignItems: 'center', backgroundColor: on ? C.blue : 'transparent', borderLeftWidth: i > 0 ? 1.5 : 0, borderLeftColor: C.border }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '900', color: on ? '#fff' : C.meta, letterSpacing: 0.3 }}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </HardShadow>

            {/* email — focus feedback is color-only: adding elevation/shadow to the wrapper of a
                focused TextInput restructures the native view tree on Android (view flattening),
                which blurs the input and instantly closes the keyboard. */}
            <Text style={{ fontSize: 11, fontWeight: '800', color: C.meta, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Email</Text>
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: focused === 'email' ? C.blue : C.border, borderRadius: 4, backgroundColor: focused === 'email' ? '#ffffff' : C.field }}>
                <View style={{ width: 42, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', borderRightWidth: 1.5, borderRightColor: C.border, backgroundColor: focused === 'email' ? C.blue : C.bg }}>
                  <Mail size={15} color={focused === 'email' ? '#ffffff' : C.meta} strokeWidth={2.5} />
                </View>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => focusField('email')}
                  onBlur={() => setFocused(null)}
                  placeholder="you@example.com"
                  placeholderTextColor="#b8b0a0"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={{ flex: 1, fontSize: 15, fontWeight: '700', color: C.dark, paddingHorizontal: 12, paddingVertical: 12 }}
                />
              </View>
            </View>

            {/* password — same color-only focus rule as the email field */}
            <Text style={{ fontSize: 11, fontWeight: '800', color: C.meta, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Password</Text>
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: focused === 'password' ? C.blue : C.border, borderRadius: 4, backgroundColor: focused === 'password' ? '#ffffff' : C.field }}>
                <View style={{ width: 42, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', borderRightWidth: 1.5, borderRightColor: C.border, backgroundColor: focused === 'password' ? C.blue : C.bg }}>
                  <Lock size={15} color={focused === 'password' ? '#ffffff' : C.meta} strokeWidth={2.5} />
                </View>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => focusField('password')}
                  onBlur={() => setFocused(null)}
                  placeholder={isLogin ? 'Your password' : 'At least 6 characters'}
                  placeholderTextColor="#b8b0a0"
                  secureTextEntry={!showPassword}
                  style={{ flex: 1, fontSize: 15, fontWeight: '700', color: C.dark, paddingHorizontal: 12, paddingVertical: 12 }}
                />
                <TouchableOpacity onPress={() => setShowPassword(s => !s)} hitSlop={8} style={{ paddingHorizontal: 12 }}>
                  {showPassword
                    ? <EyeOff size={17} color={C.meta} strokeWidth={2.5} />
                    : <Eye size={17} color={C.meta} strokeWidth={2.5} />}
                </TouchableOpacity>
              </View>
            </View>

            {error ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#ffe0e0', borderRadius: 4, borderWidth: 1.5, borderColor: C.danger, padding: 12, marginBottom: 16 }}>
                <AlertTriangle size={15} color={C.danger} strokeWidth={2.5} />
                <Text style={{ flex: 1, fontSize: 12, fontWeight: '800', color: C.danger }}>{error}</Text>
              </View>
            ) : null}

            <HardShadow>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={submit}
                disabled={busy}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.purple, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, paddingVertical: 15, opacity: busy ? 0.7 : 1 }}
              >
                <Text style={{ fontSize: 15, fontWeight: '900', color: '#fff', letterSpacing: 0.5 }}>
                  {busy ? 'Please wait…' : isLogin ? 'Sign In' : 'Create Account'}
                </Text>
                {!busy && <ArrowRight size={16} color="#ffffff" strokeWidth={2.5} />}
              </TouchableOpacity>
            </HardShadow>
            <Text style={{ fontSize: 10, fontWeight: '600', color: C.meta, textAlign: 'center', marginTop: 10, lineHeight: 14 }}>
              An account backs up your family profiles & reminders. Anything already on this device merges in automatically.
            </Text>

            {/* divider */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 20 }}>
              <View style={{ flex: 1, height: 1.5, backgroundColor: C.border, opacity: 0.25 }} />
              <Text style={{ fontSize: 10, fontWeight: '900', color: C.meta, letterSpacing: 1.5 }}>OR</Text>
              <View style={{ flex: 1, height: 1.5, backgroundColor: C.border, opacity: 0.25 }} />
            </View>

            {/* continue as guest */}
            <HardShadow style={{ width: '100%' }}>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={finish}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.blue, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, paddingVertical: 15 }}
              >
                <Text style={{ fontSize: 14, fontWeight: '900', color: '#ffffff' }}>Continue without an account</Text>
                <ArrowRight size={16} color="#ffffff" strokeWidth={2.5} />
              </TouchableOpacity>
            </HardShadow>
            <Text style={{ fontSize: 10, fontWeight: '600', color: C.meta, textAlign: 'center', marginTop: 8 }}>
              Everything works without one — your data stays on this device.
            </Text>
          </Animated.View>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}
