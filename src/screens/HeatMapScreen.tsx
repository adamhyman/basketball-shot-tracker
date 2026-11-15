import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Rect } from 'react-native-svg';

import { isMade, isFieldGoalAttempt, type Player, type Shot, shootingLine } from '../model';
import { useTheme } from '../theme';
import { COURT_W, COURT_H, type Rotation, fy } from '../court/geometry';
import { CourtFrame } from '../court/CourtFrame';
import { PlayerPicker } from '../components/PlayerPicker';

const ZONE_COLS = 11; // odd, so a zone is centered on the rim

const ZONE_ROWS = 20;

const ZONE_W = COURT_W / ZONE_COLS;

const ZONE_H = COURT_H / ZONE_ROWS;

const ZONE_GAP = 0.26; // about 2px between zones on a phone

const HEAT_RAMP = ['#ffe066', '#ffb22e', '#fd7e14', '#e8431f', '#b3140f']; // yellow to orange to red

const zoneAt = (x: number, y: number) =>
  Math.min(Math.floor(x / ZONE_W), ZONE_COLS - 1) + Math.min(Math.floor(y / ZONE_H), ZONE_ROWS - 1) * ZONE_COLS;

const zoneCol = (zone: number) => zone % ZONE_COLS;

const zoneRow = (zone: number) => Math.floor(zone / ZONE_COLS);

const heatColor = (count: number, max: number) => HEAT_RAMP[Math.ceil((count / max) * HEAT_RAMP.length) - 1];

type HeatMode = 'attempts' | 'made' | 'fg';

const MIN_FG_ATTEMPTS = 3; // fewer than this is too few shots to color by FG%

const LOW_SAMPLE_COLOR = '#dee2e6';

const HEAT_MODES: { key: HeatMode; label: string; hint: string }[] = [
  { key: 'attempts', label: 'Attempts', hint: 'Redder zones have more shot attempts. Tap one to see its shooting.' },
  { key: 'made', label: 'Made Shots', hint: 'Redder zones have more made shots. Tap one to see its shooting.' },
  {
    key: 'fg',
    label: 'FG%',
    hint: 'Redder zones have a higher FG%, which gets more reliable with more shots. Tap one to see its shooting.',
  },
];

const zoneCount = (z: Shot[], mode: HeatMode) => (mode === 'made' ? z.filter((s) => isMade(s.result)).length : z.length);

// FG% uses a fixed 0-100% scale; the counts are relative to the busiest zone (max). Null leaves the zone blank.
const zoneFill = (z: Shot[], mode: HeatMode, max: number) => {
  if (mode === 'fg') {
    if (z.length < MIN_FG_ATTEMPTS) return LOW_SAMPLE_COLOR;
    const pct = zoneCount(z, 'made') / z.length;
    return HEAT_RAMP[Math.min(Math.floor(pct * HEAT_RAMP.length), HEAT_RAMP.length - 1)];
  }
  const count = zoneCount(z, mode);
  return count > 0 ? heatColor(count, max) : null;
};

export function HeatMapScreen({
  players,
  shots,
  selected,
  setSelected,
  addPlayer,
  rotation,
  rotateCourt,
}: {
  players: Player[];
  shots: Shot[];
  selected: string | null;
  setSelected: (id: string | null) => void;
  addPlayer: (name: string) => void;
  rotation: Rotation;
  rotateCourt: () => void;
}) {
  const { styles, t } = useTheme();
  const [mode, setMode] = useState<HeatMode>('attempts');
  const [zone, setZone] = useState<number | null>(null);
  const [touchingCourt, setTouchingCourt] = useState(false);
  const zones = useMemo(() => {
    const byZone = new Map<number, Shot[]>();
    for (const s of shots) {
      if ((selected !== null && s.playerId !== selected) || !isFieldGoalAttempt(s.result)) continue;
      const i = zoneAt(s.x, s.y);
      byZone.set(i, [...(byZone.get(i) ?? []), s]);
    }
    return byZone;
  }, [shots, selected]);
  const max = Math.max(0, ...Array.from(zones.values(), (z) => zoneCount(z, mode)));
  const zoneShots = zone === null ? undefined : zones.get(zone);

  return (
    <View style={{ flex: 1 }}>
      <PlayerPicker players={players} selected={selected} onSelect={setSelected} onAdd={addPlayer} />
      <View style={styles.modeRow}>
        {HEAT_MODES.map(({ key, label }) => (
          <Pressable
            key={key}
            onPress={() => setMode(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === key }}
            style={[styles.chip, mode === key && styles.chipOn]}
          >
            <Text style={[styles.chipText, mode === key && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView scrollEnabled={!touchingCourt} contentContainerStyle={{ paddingBottom: 16 }}>
        <CourtFrame
          rotation={rotation}
          background={t.heatCourt}
          line={t.heatLine}
          hoop={t.heatHoop}
          onTap={(x, y) => setZone(zoneAt(x, y))}
          onTouchingChange={setTouchingCourt}
          underLines={Array.from(zones, ([i, z]) => {
            const fill = zoneFill(z, mode, max);
            return (
              fill && (
                <Rect
                  key={i}
                  x={zoneCol(i) * ZONE_W + ZONE_GAP / 2}
                  y={fy((zoneRow(i) + 1) * ZONE_H) + ZONE_GAP / 2}
                  width={ZONE_W - ZONE_GAP}
                  height={ZONE_H - ZONE_GAP}
                  rx={0.3}
                  fill={fill}
                />
              )
            );
          })}
        >
          {(courtZoom) =>
            zone !== null &&
            zoneShots && (
              <Rect
                x={zoneCol(zone) * ZONE_W}
                y={fy((zoneRow(zone) + 1) * ZONE_H)}
                width={ZONE_W}
                height={ZONE_H}
                rx={0.3}
                fill="none"
                stroke={t.text}
                strokeWidth={0.4 / courtZoom}
              />
            )
          }
        </CourtFrame>
        {mode === 'fg'
          ? zones.size > 0 && (
              <>
                <View style={styles.heatLegend}>
                  <Text style={styles.legendText}>0% </Text>
                  {HEAT_RAMP.map((color) => (
                    <View key={color} style={[styles.heatSwatch, { backgroundColor: color }]} />
                  ))}
                  <Text style={styles.legendText}> 100%</Text>
                </View>
                <View style={[styles.heatLegend, { marginTop: 6 }]}>
                  <View style={[styles.heatSwatch, { backgroundColor: LOW_SAMPLE_COLOR }]} />
                  <Text style={styles.legendText}> Under {MIN_FG_ATTEMPTS} attempts</Text>
                </View>
              </>
            )
          : max > 1 && (
              <View style={styles.heatLegend}>
                <Text style={styles.legendText}>Fewest: 1 </Text>
                {HEAT_RAMP.map((color) => (
                  <View key={color} style={[styles.heatSwatch, { backgroundColor: color }]} />
                ))}
                <Text style={styles.legendText}> Most: {max}</Text>
              </View>
            )}
        <Text style={styles.hint}>
          {zones.size === 0
            ? 'No shots to show yet.'
            : zoneShots
            ? `This zone: ${shootingLine(zoneShots)}`
            : HEAT_MODES.find(({ key }) => key === mode)?.hint}
        </Text>
        <Pressable onPress={rotateCourt} style={[styles.undo, { marginTop: 16, alignSelf: 'center' }]}>
          <Text style={styles.btnText}>Rotate court</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
