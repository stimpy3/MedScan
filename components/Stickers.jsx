// components/Stickers.jsx
// The app's hand-drawn neo-brutalist characters & sticker shapes (SVG, palette-driven).
// Shared by the welcome/auth screen and the home page so the identity stays consistent.
import Svg, { Circle, Path, Rect } from 'react-native-svg';

const BORDER = '#2a2a2a';

// The MedScan pill buddy: two-tone capsule, thick outline, offset hard shadow, simple face.
export function PillMascot({ size = 120, capColor = '#2198a8' }) {
  const w = 132, h = 186;
  return (
    <Svg width={size} height={(size * h) / w} viewBox={`0 0 ${w} ${h}`}>
      {/* hard offset shadow */}
      <Rect x="18" y="18" width="100" height="150" rx="50" fill={BORDER} />
      {/* capsule body */}
      <Rect x="10" y="10" width="100" height="150" rx="50" fill="#ffffff" stroke={BORDER} strokeWidth="4" />
      {/* colored top half */}
      <Path d="M12 85 L12 60 A48 48 0 0 1 108 60 L108 85 Z" fill={capColor} stroke={BORDER} strokeWidth="4" />
      {/* seam */}
      <Path d="M12 85 L108 85" stroke={BORDER} strokeWidth="4" />
      {/* shine on the cap */}
      <Rect x="30" y="28" width="12" height="30" rx="6" fill="#ffffff" opacity="0.85" transform="rotate(18 36 43)" />
      {/* face */}
      <Circle cx="45" cy="116" r="5.5" fill={BORDER} />
      <Circle cx="75" cy="116" r="5.5" fill={BORDER} />
      <Path d="M49 134 Q60 143 71 134" stroke={BORDER} strokeWidth="4" strokeLinecap="round" fill="none" />
    </Svg>
  );
}

// Four-point sparkle star.
export function StarSticker({ size = 34, fill = '#6b5390' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28">
      <Path d="M16 2 L19.4 12.6 L30 16 L19.4 19.4 L16 30 L12.6 19.4 L2 16 L12.6 12.6 Z"
        transform="translate(-2 -2)" fill={fill} stroke={BORDER} strokeWidth="2" strokeLinejoin="round" />
    </Svg>
  );
}

// Chunky plus sign.
export function PlusSticker({ size = 26, fill = '#9f9065' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 26 26">
      <Path d="M9 2 H17 V9 H24 V17 H17 V24 H9 V17 H2 V9 H9 Z"
        fill={fill} stroke={BORDER} strokeWidth="2" strokeLinejoin="round" />
    </Svg>
  );
}

// Outlined circle chip.
export function CircleSticker({ size = 22, fill = '#2198a8' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22">
      <Circle cx="11" cy="11" r="9" fill={fill} stroke={BORDER} strokeWidth="2" />
    </Svg>
  );
}
