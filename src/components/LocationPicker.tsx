import { View, Text, Pressable, ScrollView } from 'react-native';

import { type PracticeLocation } from '../model';
import { useTheme } from '../theme';

export function LocationPicker({
  locations,
  selected,
  onSelect,
  onAdd,
  onLongPress,
}: {
  locations: PracticeLocation[];
  selected: PracticeLocation | undefined;
  onSelect: (id: string) => void;
  onAdd?: () => void;
  onLongPress?: (location: PracticeLocation) => void;
}) {
  const { styles } = useTheme();
  return (
    <View style={{ paddingVertical: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}>
        {locations.map((l) => (
          <Pressable
            key={l.id}
            onPress={() => onSelect(l.id)}
            onLongPress={onLongPress && (() => onLongPress(l))}
            accessibilityState={{ selected: l === selected }}
            style={[styles.chip, l === selected && styles.chipOn]}
          >
            <Text style={[styles.chipText, l === selected && styles.chipTextOn]}>{l.name}</Text>
          </Pressable>
        ))}
        {onAdd && (
          <Pressable onPress={onAdd} style={[styles.chip, styles.chipAdd]}>
            <Text style={styles.chipText}>+ Location</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}
