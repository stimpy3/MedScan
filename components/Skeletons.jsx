// components/Skeletons.jsx
// Neo-brutalist skeleton loaders: instead of a spinner, each page shows a pulsing bare-bones
// copy of its own layout (bordered beige blocks with hard shadows) while data loads from
// AsyncStorage. One shared Animated value pulses the whole skeleton in sync.
import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import HardShadow from './HardShadow';

const C = {
  surface: '#ede8d8',
  border:  '#2a2a2a',
};

// Single bordered placeholder block — the skeleton's only building brick.
const Block = ({ w, h, r = 4, style }) => (
  <View style={[{ width: w, height: h, borderRadius: r, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface }, style]} />
);

// Wraps a whole skeleton screen in one synced pulse (0.4 ↔ 1 opacity).
function Pulse({ children }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.4, duration: 650, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.sin), useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return <Animated.View style={{ flex: 1, opacity: v }}>{children}</Animated.View>;
}

// Shared header ghost: back-button square + rotated title badge (matches profiles/reminders).
const HeaderGhost = () => (
  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 16, borderBottomWidth: 1.5, borderBottomColor: C.border, marginBottom: 20 }}>
    <HardShadow offset={2}><Block w={36} h={36} /></HardShadow>
    <View style={{ transform: [{ rotate: '-2deg' }] }}>
      <Block w={150} h={30} />
    </View>
    <View style={{ width: 40 }} />
  </View>
);

// ── Profiles page: avatar switcher row, account bar, two form cards ──────────────────────────
export function ProfileSkeleton() {
  return (
    <Pulse>
      <HeaderGhost />

      {/* avatar tiles */}
      <View style={{ flexDirection: 'row', gap: 14, paddingVertical: 6, marginBottom: 6 }}>
        {[0, 1, 2].map(i => (
          <View key={i} style={{ alignItems: 'center', width: 64 }}>
            <HardShadow offset={2} borderRadius={28}><Block w={56} h={56} r={28} /></HardShadow>
            <Block w={40} h={10} style={{ marginTop: 6 }} />
          </View>
        ))}
      </View>

      {/* account bar */}
      <HardShadow offset={3} style={{ width: '100%', marginVertical: 18 }}>
        <Block w="100%" h={58} />
      </HardShadow>

      {/* "About" card */}
      <HardShadow offset={3} style={{ width: '100%', marginBottom: 18 }}>
        <View style={{ borderWidth: 1.5, borderColor: C.border, borderRadius: 4, backgroundColor: '#ffffff', padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Block w={32} h={32} />
            <Block w={140} h={16} />
          </View>
          <Block w={70} h={10} style={{ marginBottom: 8 }} />
          <Block w="100%" h={46} style={{ marginBottom: 16 }} />
          <Block w={70} h={10} style={{ marginBottom: 8 }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {[54, 70, 62, 66, 50].map((w, i) => <Block key={i} w={w} h={36} />)}
          </View>
          <Block w={90} h={10} style={{ marginBottom: 8 }} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[0, 1, 2].map(i => <Block key={i} w="31%" h={42} style={{ flex: 1 }} />)}
          </View>
        </View>
      </HardShadow>

      {/* "Health details" card */}
      <HardShadow offset={3} style={{ width: '100%' }}>
        <View style={{ borderWidth: 1.5, borderColor: C.border, borderRadius: 4, backgroundColor: '#ffffff', padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Block w={32} h={32} />
            <Block w={120} h={16} />
          </View>
          <Block w={80} h={10} style={{ marginBottom: 8 }} />
          <Block w="100%" h={40} style={{ marginBottom: 16 }} />
          <Block w={90} h={10} style={{ marginBottom: 8 }} />
          <Block w="100%" h={40} />
        </View>
      </HardShadow>
    </Pulse>
  );
}

// ── Reminders page: month strip, week row, timeline rows with one card each ──────────────────
export function RemindersSkeleton() {
  return (
    <Pulse>
      <HeaderGhost />

      {/* month strip */}
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 14 }}>
        {[0, 1, 2, 3, 4, 5].map(i => <Block key={i} w={52} h={32} />)}
      </View>

      {/* week row */}
      <View style={{ flexDirection: 'row', gap: 5, marginBottom: 24 }}>
        {[0, 1, 2, 3, 4, 5, 6].map(i => <Block key={i} h={58} style={{ flex: 1 }} />)}
      </View>

      {/* day label line */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
        <Block w={70} h={12} />
        <Block w={90} h={12} />
      </View>

      {/* timeline rows */}
      {[0, 1, 2].map(i => (
        <View key={i} style={{ flexDirection: 'row', marginBottom: 20 }}>
          <View style={{ width: 44, paddingTop: 4 }}>
            <Block w={30} h={12} />
          </View>
          <View style={{ flex: 1, borderTopWidth: 2, borderTopColor: 'rgba(42,42,42,0.2)', paddingTop: 10 }}>
            <HardShadow style={{ width: 204 }}>
              <View style={{ borderWidth: 1.5, borderColor: C.border, borderRadius: 4, backgroundColor: '#ffffff', padding: 12 }}>
                <Block w={110} h={13} style={{ marginBottom: 8 }} />
                <Block w={80} h={10} />
              </View>
            </HardShadow>
          </View>
        </View>
      ))}
    </Pulse>
  );
}
