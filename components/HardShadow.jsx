// Cross-platform hard offset shadow for neo-brutalism.
// Uses paddingRight/Bottom to create space, then an absolutely
// positioned View fills that space offset by `offset` px.
import { View } from 'react-native';

export default function HardShadow({ children, borderRadius = 4, offset = 4, color = '#2a2a2a', style }) {
  return (
    <View style={[{ paddingRight: offset, paddingBottom: offset }, style]}>
      <View style={{ position: 'absolute', backgroundColor: color, borderRadius, top: offset, left: offset, right: 0, bottom: 0 }} />
      {children}
    </View>
  );
}
