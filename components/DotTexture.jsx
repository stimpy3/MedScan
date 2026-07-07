// components/DotTexture.jsx
// Full-screen, very-low-contrast dot grid that drifts diagonally forever — the "paper grain"
// under the home screen. The grid period equals the drift distance, so each loop iteration is
// pixel-identical to the last, and the loop itself runs on Reanimated's UI thread (withRepeat),
// not RN's plain Animated.loop — that distinction matters: Animated.loop has to round-trip
// through the JS thread to restart every iteration, which is exactly where a visible stutter
// can creep in. withRepeat restarts natively with no JS hand-off, so the seam is truly invisible.
// pointerEvents="none": purely decorative, never intercepts touches.
import { useEffect } from 'react';
import { Dimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

const SPACING = 30;      // grid period (px) — fewer dots = cheaper texture to rasterize
const RADIUS = 1.7;
const DRIFT_MS = 9000;   // time to drift ONE grid cell — slow, barely-there motion
// Drift many cells per loop iteration. The pattern is periodic every SPACING px, so the loop
// boundary is invisible in theory — but stretching one iteration to ~90s makes any restart
// frame hiccup effectively unobservable too.
const CELLS_PER_LOOP = 10;

export default function DotTexture({ color = '#8a7850', opacity = 0.10 }) {
  const { width, height } = Dimensions.get('window');
  const drift = useSharedValue(0);

  useEffect(() => {
    drift.value = withRepeat(
      withTiming(-SPACING * CELLS_PER_LOOP, { duration: DRIFT_MS * CELLS_PER_LOOP, easing: Easing.linear }),
      -1,
      false // false = always forward (0 → -N), never ping-pong — ping-pong would reverse at the peak
    );
  }, []);

  const driftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drift.value }, { translateY: drift.value }],
  }));

  // Canvas must cover the screen at maximum drift: one spare cell on the leading edge plus
  // CELLS_PER_LOOP cells of travel on the trailing edge.
  const w = width + SPACING * (CELLS_PER_LOOP + 2);
  const h = height + SPACING * (CELLS_PER_LOOP + 2);
  const cols = Math.ceil(w / SPACING);
  const rows = Math.ceil(h / SPACING);
  const dots = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      dots.push(<Circle key={`${r}-${c}`} cx={c * SPACING} cy={r * SPACING} r={RADIUS} fill={color} />);
    }
  }

  return (
    <Animated.View
      pointerEvents="none"
      // Rasterize the SVG ONCE into a GPU texture; the drift then only moves that texture.
      // Without this, some devices re-rasterize the whole dot field every frame, which tanks
      // the frame rate and makes every animation on the screen look choppy.
      renderToHardwareTextureAndroid
      shouldRasterizeIOS
      style={[{ position: 'absolute', top: -SPACING, left: -SPACING, opacity }, driftStyle]}
    >
      <Svg width={w} height={h}>{dots}</Svg>
    </Animated.View>
  );
}
