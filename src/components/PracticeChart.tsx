import { useWindowDimensions } from 'react-native';
import Svg, { G, Rect, Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { useTheme } from '../theme';
import { startOfDay } from '../dates';

// How much time each point on the chart covers.
export type ChartBucket = 'day' | 'week' | 'month';

export const bucketStart = (date: number, bucket: ChartBucket) => {
  const d = new Date(startOfDay(date));
  if (bucket === 'week') d.setDate(d.getDate() - d.getDay());
  if (bucket === 'month') d.setDate(1);
  return d.getTime();
};

const axisLabel = (start: number, bucket: ChartBucket) =>
  new Date(start).toLocaleDateString(undefined, bucket === 'month' ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' });

// A round number at least n, for the top of the attempts axis.
const niceMax = (n: number) => {
  const p = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 5, 10].map((m) => m * p).find((v) => v >= n) ?? n;
};

const CHART_H = 220;

const CHART_PAD = { left: 40, right: 36, top: 10, bottom: 24 };

const PCT_TICKS = [0, 0.25, 0.5, 0.75, 1];

export type ChartSeries = { id: string; color: string; points: { i: number; pct: number }[] };

export function PracticeChart({
  buckets,
  bucket,
  series,
  attempts,
  active,
  onSelect,
}: {
  buckets: number[];
  bucket: ChartBucket;
  series: ChartSeries[];
  attempts: number[];
  active: number | null;
  onSelect: (i: number) => void;
}) {
  const { t } = useTheme();
  const { width } = useWindowDimensions();
  const w = Math.min(width - 24, 600);
  const plotW = w - CHART_PAD.left - CHART_PAD.right;
  const plotH = CHART_H - CHART_PAD.top - CHART_PAD.bottom;
  const bottom = CHART_PAD.top + plotH;
  const slot = plotW / buckets.length;
  const cx = (i: number) => CHART_PAD.left + slot * (i + 0.5);
  const py = (pct: number) => CHART_PAD.top + plotH * (1 - pct);
  const maxAttempts = niceMax(Math.max(1, ...attempts));
  const ay = (n: number) => CHART_PAD.top + plotH * (1 - n / maxAttempts);
  const barW = Math.max(Math.min(slot - 2, 18), 1);
  const labelEvery = Math.ceil(buckets.length / 5);

  return (
    <Svg width={w} height={CHART_H}>
      {PCT_TICKS.map((p) => (
        <G key={p}>
          <Line x1={CHART_PAD.left} x2={w - CHART_PAD.right} y1={py(p)} y2={py(p)} stroke={t.grid} strokeWidth={1} />
          <SvgText x={CHART_PAD.left - 6} y={py(p) + 3.5} fontSize={10} fill={t.muted} textAnchor="end">
            {`${p * 100}%`}
          </SvgText>
        </G>
      ))}
      {[0, maxAttempts / 2, maxAttempts].filter(Number.isInteger).map((n) => (
        <SvgText key={n} x={w - CHART_PAD.right + 6} y={ay(n) + 3.5} fontSize={10} fill={t.muted} textAnchor="start">
          {`${n}`}
        </SvgText>
      ))}
      {attempts.map(
        (n, i) =>
          n > 0 && (
            <Rect key={i} x={cx(i) - barW / 2} y={ay(n)} width={barW} height={bottom - ay(n)} rx={Math.min(2, barW / 2)} fill={t.bar} />
          ),
      )}
      <Line x1={CHART_PAD.left} x2={w - CHART_PAD.right} y1={bottom} y2={bottom} stroke={t.border} strokeWidth={1} />
      {buckets.map(
        (start, i) =>
          (buckets.length - 1 - i) % labelEvery === 0 && (
            <SvgText key={start} x={cx(i)} y={CHART_H - 6} fontSize={10} fill={t.muted} textAnchor="middle">
              {axisLabel(start, bucket)}
            </SvgText>
          ),
      )}
      {active !== null && <Line x1={cx(active)} x2={cx(active)} y1={CHART_PAD.top} y2={bottom} stroke={t.mutedStrong} strokeWidth={1} />}
      {series.map(
        ({ id, color, points }) =>
          points.length > 1 && (
            <Path
              key={id}
              d={points.map(({ i, pct }, n) => `${n === 0 ? 'M' : 'L'}${cx(i)} ${py(pct)}`).join(' ')}
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              fill="none"
            />
          ),
      )}
      {series.map(({ id, color, points }) =>
        points.map(({ i, pct }) => (
          <Circle key={`${id}-${i}`} cx={cx(i)} cy={py(pct)} r={active === i ? 5.5 : 4} fill={color} stroke={t.surface} strokeWidth={2} />
        )),
      )}
      {/* Tap anywhere in a column to see that day, week or month. */}
      {buckets.map((start, i) => (
        <Rect key={start} x={CHART_PAD.left + slot * i} y={0} width={slot} height={CHART_H} fill="#000" fillOpacity={0} onPress={() => onSelect(i)} />
      ))}
    </Svg>
  );
}
