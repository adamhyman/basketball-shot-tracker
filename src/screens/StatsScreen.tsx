import { View, Text, ScrollView } from 'react-native';

import {
  isMade,
  hasFoul,
  type Player,
  type Shot,
  type FreeThrow,
  type Rebound,
  REBOUND_KINDS,
  shootingLine,
} from '../model';
import { useTheme } from '../theme';
import { isThree } from '../court/geometry';

const totalPoints = (shots: Shot[], freeThrows: FreeThrow[]) =>
  shots.filter((x) => isMade(x.result)).reduce((sum, x) => sum + (isThree(x) ? 3 : 2), 0) +
  freeThrows.filter((x) => x.made).length;

export function StatsScreen({
  players,
  shots,
  freeThrows,
  rebounds,
}: {
  players: Player[];
  shots: Shot[];
  freeThrows: FreeThrow[];
  rebounds: Rebound[];
}) {
  const { styles } = useTheme();
  if (players.length === 0) return <Text style={styles.hint}>No players yet.</Text>;
  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
      {players.map((p) => {
        const s = shots.filter((x) => x.playerId === p.id);
        const ft = freeThrows.filter((x) => x.playerId === p.id);
        const r = rebounds.filter((x) => x.playerId === p.id);
        const untyped = r.filter((x) => !x.kind).length;
        return (
          <View key={p.id} style={styles.statCard}>
            <Text style={styles.statName}>{p.name}</Text>
            <Text style={styles.statLine}>Points {totalPoints(s, ft)}</Text>
            <Text style={styles.statLine}>FG {shootingLine(s)}</Text>
            <Text style={styles.statLine}>3PT {shootingLine(s.filter(isThree))}</Text>
            <Text style={styles.statLine}>FT {ft.filter((x) => x.made).length}/{ft.length}</Text>
            {REBOUND_KINDS.map(({ key, label }) => (
              <Text key={key} style={styles.statLine}>
                {label} {r.filter((x) => x.kind === key).length}
              </Text>
            ))}
            {untyped > 0 && <Text style={styles.statSmall}>Rebounds with no type: {untyped}</Text>}
            <Text style={styles.statSmall}>Fouled on {s.filter((x) => hasFoul(x.result)).length} shots</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}
