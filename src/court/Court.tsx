import { Circle, Line, Path } from 'react-native-svg';

import { type ShotResult, isMade, hasFoul, type Shot } from '../model';
import { COURT_W, COURT_H, type Rotation, fy } from './geometry';
import { type CourtTexture, type CourtColors } from './colors';
import { CourtFrame } from './CourtFrame';

const rectPath = (x: number, y: number, w: number, h: number) => `M${x} ${y}h${w}v${h}h${-w}z`;

// Each texture is the secondary-colored parts of the floor, as one path so it stays cheap to redraw.
const hardwoodPath = (boardW: number, plankL: number, seam: number) => {
  let d = '';
  for (let board = 0; board * boardW < COURT_W; board++) {
    const x = board * boardW;
    const w = Math.min(boardW, COURT_W - x);
    const secondary = board % 2 === 0; // boards alternate tone; the rest stays the court color
    for (let start = (board * 5) % plankL - plankL; start < COURT_H; start += plankL) {
      // Secondary boards leave a gap at each plank end; the others get a thin seam there.
      const top = Math.max(secondary ? start + seam : start, 0);
      const bottom = Math.min(secondary ? start + plankL : start + seam, COURT_H);
      if (bottom > top) d += rectPath(x, top, w, bottom - top);
    }
  }
  return d;
};

const parquetPath = (size: number) => {
  let d = '';
  for (let col = 0; col * size < COURT_W; col++) {
    for (let row = 0; row * size < COURT_H; row++) {
      if ((col + row) % 2 === 0) d += rectPath(col * size, row * size, size, Math.min(size, COURT_H - row * size));
    }
  }
  return d;
};

const TEXTURE_PATHS: Record<Exclude<CourtTexture, 'solid'>, string> = {
  hardwood: hardwoodPath(1.5, 14, 0.2),
  parquet: parquetPath(5),
};

export function CourtTextureLayer({ colors }: { colors: CourtColors }) {
  return colors.texture === 'solid' ? null : <Path d={TEXTURE_PATHS[colors.texture]} fill={colors.secondary} />;
}

// m scales the marker, e.g. to keep it the same size on screen while zoomed.
export function ShotMarker({ cx, cy, result, m, colors }: { cx: number; cy: number; result: ShotResult; m: number; colors: CourtColors }) {
  return (
    <>
      {isMade(result) ? (
        <Circle cx={cx} cy={cy} r={m} fill={colors.make} stroke={colors.makeBorder} strokeWidth={0.15 * m} />
      ) : (
        <>
          <Line x1={cx - 0.9 * m} y1={cy - 0.9 * m} x2={cx + 0.9 * m} y2={cy + 0.9 * m} stroke={colors.miss} strokeWidth={0.45 * m} strokeLinecap="round" />
          <Line x1={cx - 0.9 * m} y1={cy + 0.9 * m} x2={cx + 0.9 * m} y2={cy - 0.9 * m} stroke={colors.miss} strokeWidth={0.45 * m} strokeLinecap="round" />
        </>
      )}
      {hasFoul(result) && <Circle cx={cx} cy={cy} r={1.7 * m} fill="none" stroke={colors.foul} strokeWidth={0.3 * m} />}
    </>
  );
}

export function Court({
  shots,
  rotation,
  colors,
  onTapCourt,
  onTouchingChange,
  fill,
}: {
  shots: Shot[];
  rotation: Rotation;
  colors: CourtColors;
  onTapCourt: (x: number, y: number) => void;
  onTouchingChange: (touching: boolean) => void;
  fill?: boolean;
}) {
  return (
    <CourtFrame
      rotation={rotation}
      background={colors.court}
      line={colors.line}
      hoop={colors.hoop}
      onTap={onTapCourt}
      onTouchingChange={onTouchingChange}
      underLines={<CourtTextureLayer colors={colors} />}
      fill={fill}
    >
      {(zoom) => shots.map((s) => <ShotMarker key={s.id} cx={s.x} cy={fy(s.y)} result={s.result} m={1 / zoom} colors={colors} />)}
    </CourtFrame>
  );
}
