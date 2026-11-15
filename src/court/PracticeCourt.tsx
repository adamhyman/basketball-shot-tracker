import { View, useWindowDimensions } from 'react-native';
import Svg, { G, Rect, Circle, Line, Text as SvgText } from 'react-native-svg';

import { useTheme } from '../theme';
import { PRACTICE_SPOTS, sideAt, practiceShotId } from '../practice';
import { COURT_W, COURT_H, HALF_COURT, RIM_X, type Rotation, ROTATION_TRANSFORMS, fy, rotatePoint } from './geometry';
import { type CourtColors } from './colors';
import { HalfCourtLines } from './CourtFrame';
import { CourtTextureLayer } from './Court';

// The near half of the court, wherever the rotation puts it in the drawing.
const NEAR_HALF_VIEWBOX: Record<Rotation, string> = {
  0: `0 ${HALF_COURT} ${COURT_W} ${HALF_COURT}`,
  90: `0 0 ${HALF_COURT} ${COURT_W}`,
  180: `0 0 ${COURT_W} ${HALF_COURT}`,
  270: `${HALF_COURT} 0 ${HALF_COURT} ${COURT_W}`,
};

// Which way on screen points away from the baseline, toward half court.
const HALF_COURT_DIRECTION: Record<Rotation, 'up' | 'right' | 'down' | 'left'> = { 0: 'up', 90: 'right', 180: 'down', 270: 'left' };

const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' } as const;

export function PracticeCourt({
  colors,
  rotation,
  selected,
  onSelect,
}: {
  colors: CourtColors;
  rotation: Rotation;
  selected: string | null;
  onSelect: (shot: string) => void;
}) {
  const { t } = useTheme();
  const { width } = useWindowDimensions();
  const sideways = rotation % 180 !== 0;
  const w = Math.min(width - 24, 600);
  const h = sideways ? (w * COURT_W) / HALF_COURT : (w * HALF_COURT) / COURT_W;
  const sw = 0.3;
  return (
    <View style={{ width: w, height: h, alignSelf: 'center', borderRadius: 8, overflow: 'hidden' }}>
      <Svg width="100%" height="100%" viewBox={NEAR_HALF_VIEWBOX[rotation]}>
        <G transform={ROTATION_TRANSFORMS[rotation]}>
          <Rect x={0} y={0} width={COURT_W} height={COURT_H} fill={colors.court} />
          <CourtTextureLayer colors={colors} />
          <Rect x={0.15} y={0.15} width={COURT_W - 0.3} height={COURT_H - 0.3} fill="none" stroke={colors.line} strokeWidth={sw} />
          <Line x1={0} y1={HALF_COURT} x2={COURT_W} y2={HALF_COURT} stroke={colors.line} strokeWidth={sw} />
          <Circle cx={25} cy={HALF_COURT} r={6} fill="none" stroke={colors.line} strokeWidth={sw} />
          <HalfCourtLines line={colors.line} hoop={colors.hoop} sw={sw} />
        </G>
        {/* Spots are placed outside the rotation so their labels stay upright. */}
        {PRACTICE_SPOTS.flatMap((spot) =>
          (spot.x === RIM_X ? [spot.x] : [spot.x, COURT_W - spot.x]).map((x) => {
            const id = practiceShotId(spot.key, x === RIM_X ? null : sideAt(x));
            const on = selected === id;
            const [sx, sy] = rotatePoint(x, fy(spot.y), rotation);
            const dir = spot.below ? OPPOSITE[HALF_COURT_DIRECTION[rotation]] : HALF_COURT_DIRECTION[rotation];
            const vertical = dir === 'up' || dir === 'down';
            const edgeX = sx < COURT_W / 2 ? 0.4 : COURT_W - 0.4;
            const label =
              vertical
                ? {
                    x: spot.edge ? edgeX : sx,
                    y: dir === 'up' ? sy - 1.9 : sy + 2.7,
                    anchor: spot.edge ? (edgeX < COURT_W / 2 ? 'start' : 'end') : 'middle',
                  }
                : { x: dir === 'right' ? sx + 1.8 : sx - 1.8, y: sy + 0.55, anchor: dir === 'right' ? 'start' : 'end' };
            return (
              <G key={id} onPress={() => onSelect(id)}>
                {/* a bigger, invisible circle so the spot is easy to tap */}
                <Circle cx={sx} cy={sy} r={3} fill="#000" fillOpacity={0} />
                <Circle
                  cx={sx}
                  cy={sy}
                  r={1.2}
                  fill={on ? t.accent : colors.line}
                  fillOpacity={on ? 1 : 0.5}
                  stroke={on ? '#fff' : colors.line}
                  strokeWidth={0.3}
                />
                <SvgText
                  x={label.x}
                  y={label.y}
                  fontSize={1.6}
                  fontWeight={on ? '800' : '600'}
                  fill={on ? t.accent : colors.line}
                  textAnchor={label.anchor as 'start' | 'middle' | 'end'}
                >
                  {spot.short}
                </SvgText>
              </G>
            );
          }),
        )}
      </Svg>
    </View>
  );
}
