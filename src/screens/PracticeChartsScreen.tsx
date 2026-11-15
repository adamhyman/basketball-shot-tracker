import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';

import { type PracticeLocation, type PracticeSession } from '../model';
import { useTheme } from '../theme';
import { formatDate, startOfDay, addDays } from '../dates';
import { PRACTICE_SHOTS, practiceLine } from '../practice';
import { LocationPicker } from '../components/LocationPicker';
import { type ChartBucket, bucketStart, type ChartSeries, PracticeChart } from '../components/PracticeChart';

type ChartRange = 'week' | 'month' | 'year' | 'all';

const CHART_RANGES: { key: ChartRange; label: string; summary: string }[] = [
  { key: 'week', label: '1 Week', summary: 'Last 7 days' },
  { key: 'month', label: '1 Month', summary: 'Last 30 days' },
  { key: 'year', label: '1 Year', summary: 'Last 12 months' },
  { key: 'all', label: 'All Time', summary: 'All time' },
];

const nextBucket = (start: number, bucket: ChartBucket) => {
  const d = new Date(start);
  if (bucket === 'month') d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + (bucket === 'week' ? 7 : 1));
  return d.getTime();
};

const bucketLabel = (start: number, bucket: ChartBucket) =>
  bucket === 'day'
    ? formatDate(start)
    : bucket === 'week'
    ? `Week of ${new Date(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : new Date(start).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

// The first day shown and how the time is split up. All time picks a bucket to fit how long you've practiced.
const chartPeriod = (range: ChartRange, sessions: PracticeSession[]): { start: number; bucket: ChartBucket } => {
  const today = startOfDay(Date.now());
  if (range === 'week') return { start: addDays(today, -6), bucket: 'day' };
  if (range === 'month') return { start: addDays(today, -29), bucket: 'day' };
  if (range === 'year') {
    const d = new Date(today);
    d.setFullYear(d.getFullYear() - 1);
    return { start: addDays(d.getTime(), 1), bucket: 'week' };
  }
  const first = sessions.reduce((min, s) => Math.min(min, startOfDay(s.date)), today);
  const days = (today - first) / (24 * 60 * 60 * 1000);
  return { start: first, bucket: days < 31 ? 'day' : days <= 366 ? 'week' : 'month' };
};

export function PracticeChartsScreen({
  locations,
  sessions,
  selected,
  setSelected,
}: {
  locations: PracticeLocation[];
  sessions: PracticeSession[];
  selected: string | null;
  setSelected: (id: string) => void;
}) {
  const { styles, t } = useTheme();
  const [range, setRange] = useState<ChartRange>('week');
  const [active, setActive] = useState<number | null>(null); // the tapped bucket's start
  // The chosen shots and the color slot each keeps while it's chosen, so colors don't shift as others are toggled.
  const [picked, setPicked] = useState<{ locationId: string; slots: Record<string, number> } | null>(null);

  const location = locations.find((l) => l.id === selected) ?? locations[0];
  const here = useMemo(() => sessions.filter((s) => s.locationId === location?.id), [sessions, location]);
  const practiced = [...PRACTICE_SHOTS, ...(location?.customShots ?? [])].filter((s) => here.some((x) => x.shot === s.id));
  const slots: Record<string, number> =
    location && picked?.locationId === location.id
      ? picked.slots
      : Object.fromEntries(practiced.slice(0, t.series.length).map((s, i) => [s.id, i]));
  const chosen = practiced.filter((s) => s.id in slots);
  const full = chosen.length >= t.series.length;

  const { start, bucket } = chartPeriod(range, here);
  const buckets = useMemo(() => {
    const list: number[] = [];
    for (let b = bucketStart(start, bucket); b <= Date.now(); b = nextBucket(b, bucket)) list.push(b);
    return list;
  }, [start, bucket]);
  const inRange = here.filter((s) => s.date >= start && s.shot in slots);
  const index = new Map(buckets.map((b, i) => [b, i]));
  const bucketOf = (s: PracticeSession) => index.get(bucketStart(s.date, bucket)) ?? -1;

  const attempts = buckets.map(() => 0);
  for (const s of inRange) if (bucketOf(s) >= 0) attempts[bucketOf(s)] += s.attempts;
  const series: ChartSeries[] = chosen.map(({ id }) => {
    const made = buckets.map(() => 0);
    const tried = buckets.map(() => 0);
    for (const s of inRange) {
      const i = bucketOf(s);
      if (s.shot !== id || i < 0) continue;
      made[i] += s.made;
      tried[i] += s.attempts;
    }
    return {
      id,
      color: t.series[slots[id]],
      points: tried.flatMap((n, i) => (n > 0 ? [{ i, pct: made[i] / n }] : [])),
    };
  });

  const activeIndex = active === null ? null : index.get(active) ?? null;
  const detail = activeIndex === null ? inRange : inRange.filter((s) => bucketOf(s) === activeIndex);
  const detailRows = chosen.filter((s) => detail.some((x) => x.shot === s.id));

  const toggle = (id: string) => {
    if (!location) return;
    const next = { ...slots };
    if (id in next) delete next[id];
    else {
      const used = new Set(Object.values(next));
      const free = t.series.findIndex((_, i) => !used.has(i));
      if (free < 0) return;
      next[id] = free;
    }
    setPicked({ locationId: location.id, slots: next });
  };

  if (!location) return <Text style={styles.hint}>Add a location in Shot Practice to see charts.</Text>;

  return (
    <View style={{ flex: 1 }}>
      <LocationPicker
        locations={locations}
        selected={location}
        onSelect={(id) => {
          setSelected(id);
          setActive(null);
        }}
      />
      <View style={styles.modeRow}>
        {CHART_RANGES.map(({ key, label }) => (
          <Pressable
            key={key}
            onPress={() => {
              setRange(key);
              setActive(null);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: range === key }}
            style={[styles.chip, range === key && styles.chipOn]}
          >
            <Text style={[styles.chipText, range === key && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {practiced.length === 0 ? (
        <Text style={styles.hint}>No practice results at {location.name} yet.</Text>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
          <View style={styles.chartCard}>
            <View style={styles.chartAxisTitles}>
              <Text style={styles.statSmall}>Make %  (lines)</Text>
              <Text style={styles.statSmall}>Attempts  (bars)</Text>
            </View>
            <PracticeChart
              buckets={buckets}
              bucket={bucket}
              series={series}
              attempts={attempts}
              active={activeIndex}
              onSelect={(i) => setActive((prev) => (prev === buckets[i] ? null : buckets[i]))}
            />
          </View>
          {inRange.length === 0 && <Text style={styles.hint}>No results for these shots in this period.</Text>}

          <View style={styles.shotChips}>
            {practiced.map((s) => {
              const on = s.id in slots;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => toggle(s.id)}
                  disabled={!on && full}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: !on && full }}
                  style={[styles.chip, styles.seriesChip, !on && full && { opacity: 0.4 }]}
                >
                  <View style={[styles.seriesDot, on ? { backgroundColor: t.series[slots[s.id]] } : { borderWidth: 1.5, borderColor: t.muted }]} />
                  <Text style={[styles.chipText, !on && { color: t.muted }]}>{s.name}</Text>
                </Pressable>
              );
            })}
          </View>
          {full && practiced.length > chosen.length && (
            <Text style={styles.hint}>Up to {t.series.length} shots at a time. Unselect one to add another.</Text>
          )}

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>
              {activeIndex === null ? CHART_RANGES.find(({ key }) => key === range)?.summary : bucketLabel(buckets[activeIndex], bucket)}
            </Text>
            {detailRows.length === 0 && <Text style={styles.statSmall}>No results.</Text>}
            {detailRows.map((s) => (
              <View key={s.id} style={styles.practiceRow}>
                <View style={[styles.seriesDot, { backgroundColor: t.series[slots[s.id]], marginRight: 8 }]} />
                <Text style={[styles.statLine, { flex: 1 }]}>{s.name}</Text>
                <Text style={styles.statLine}>{practiceLine(detail.filter((x) => x.shot === s.id))}</Text>
              </View>
            ))}
            {detailRows.length > 1 && (
              <View style={styles.practiceRow}>
                <Text style={[styles.statLine, { flex: 1, fontWeight: '700' }]}>All selected shots</Text>
                <Text style={[styles.statLine, { fontWeight: '700' }]}>{practiceLine(detail)}</Text>
              </View>
            )}
            <Text style={styles.statSmall}>
              {activeIndex === null ? 'Tap the chart to see a single point.' : 'Tap the same point again to see the whole period.'}
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}
