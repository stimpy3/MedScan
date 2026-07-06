import { ExternalLink, MapPin, Package, Tag } from 'lucide-react-native';
import { Linking, Text, TouchableOpacity, View } from 'react-native';
import HardShadow from './HardShadow';

const C = {
  bg:      '#faf9f5',
  surface: '#ede8d8',
  border:  '#2a2a2a',
  blue:    '#2198a8',
  green:   '#2a8a5f',
  red:     '#c0392b',
  ochre:   '#9f9065',
  dark:    '#2a2a2a',
  white:   '#ffffff',
};

function Badge({ available }) {
  if (available === true) {
    return (
      <View style={{ backgroundColor: C.green, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
        <Text style={{ color: C.white, fontWeight: '900', fontSize: 12 }}>IN STOCK</Text>
      </View>
    );
  }
  if (available === false) {
    return (
      <View style={{ backgroundColor: C.red, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
        <Text style={{ color: C.white, fontWeight: '900', fontSize: 12 }}>OUT OF STOCK</Text>
      </View>
    );
  }
  return (
    <View style={{ backgroundColor: C.ochre, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
      <Text style={{ color: C.white, fontWeight: '900', fontSize: 12 }}>CHECK ON 1MG</Text>
    </View>
  );
}

function Row({ icon: Icon, label, value }) {
  if (!value && value !== 0) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border }}>
      <View style={{ backgroundColor: C.blue, width: 32, height: 32, borderRadius: 4, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={15} color={C.white} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 11, color: C.ochre, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
        <Text style={{ fontSize: 15, color: C.dark, fontWeight: '700' }}>{value}</Text>
      </View>
    </View>
  );
}

export default function AvailabilityCard({ data }) {
  if (!data) return null;

  const { medicineName, pincode, available, price, mrp, deliveryDays, url, matchedName } = data;

  const discount = mrp && price && mrp > price
    ? Math.round(((mrp - price) / mrp) * 100)
    : null;

  const priceDisplay = price != null
    ? `₹${price}${discount ? `  (${discount}% off MRP ₹${mrp})` : ''}`
    : mrp != null ? `MRP ₹${mrp}` : null;

  const deliveryDisplay = deliveryDays != null
    ? `Delivered in ${deliveryDays} day${deliveryDays !== 1 ? 's' : ''}`
    : null;

  return (
    <HardShadow style={{ width: '100%', marginVertical: 6 }}>
      <View style={{ backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, padding: 16 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <Text style={{ fontSize: 17, fontWeight: '900', color: C.dark }}>{medicineName}</Text>
            {matchedName && matchedName.toLowerCase() !== medicineName.toLowerCase() ? (
              <Text style={{ fontSize: 12, color: C.ochre, marginTop: 2 }}>Matched: {matchedName}</Text>
            ) : null}
          </View>
          <Badge available={available} />
        </View>

        {/* Details rows */}
        <Row icon={MapPin} label="Pincode" value={pincode} />
        <Row icon={Tag} label="Price" value={priceDisplay} />
        <Row icon={Package} label="Delivery" value={deliveryDisplay} />

        {/* 1mg link */}
        {url ? (
          <TouchableOpacity
            onPress={() => Linking.openURL(url)}
            activeOpacity={0.8}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, backgroundColor: C.blue, borderWidth: 1.5, borderColor: C.border, borderRadius: 4, paddingVertical: 12 }}
          >
            <ExternalLink size={16} color={C.white} />
            <Text style={{ color: C.white, fontWeight: '900', fontSize: 14 }}>View on 1mg</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </HardShadow>
  );
}
