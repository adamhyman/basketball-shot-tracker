import { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';

import { type Player } from '../model';
import { useTheme } from '../theme';
import { NamePrompt } from './NamePrompt';

export function PlayerPicker({
  players,
  selected,
  onSelect,
  onAdd,
}: {
  players: Player[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (name: string) => void;
}) {
  const { styles } = useTheme();
  const [adding, setAdding] = useState(false);

  return (
    <View style={{ paddingVertical: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}>
        <Pressable onPress={() => onSelect(null)} style={[styles.chip, selected === null && styles.chipOn]}>
          <Text style={[styles.chipText, selected === null && styles.chipTextOn]}>All</Text>
        </Pressable>
        {players.map((p) => (
          <Pressable key={p.id} onPress={() => onSelect(p.id)} style={[styles.chip, selected === p.id && styles.chipOn]}>
            <Text style={[styles.chipText, selected === p.id && styles.chipTextOn]}>{p.name}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setAdding(true)} style={[styles.chip, styles.chipAdd]}>
          <Text style={styles.chipText}>+ Player</Text>
        </Pressable>
      </ScrollView>

      <NamePrompt visible={adding} title="New player" placeholder="Name" onSubmit={onAdd} onClose={() => setAdding(false)} />
    </View>
  );
}
