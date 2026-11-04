import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Modal,
  TextInput,
  StyleSheet,
  Share,
  Alert,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';
import Svg, { G, Rect, Circle, Line, Path } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  GestureDetector,
  GestureHandlerRootView,
  useCompetingGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';

// ---------- Types ----------

type ShotResult = 'made' | 'madeFoul' | 'missed' | 'missedFoul';

const RESULTS: { key: ShotResult; label: string }[] = [
  { key: 'made', label: 'Made' },
  { key: 'madeFoul', label: 'Made with foul' },
  { key: 'missed', label: 'Missed' },
  { key: 'missedFoul', label: 'Missed with foul' },
];

const isMade = (r: ShotResult) => r === 'made' || r === 'madeFoul';
const hasFoul = (r: ShotResult) => r === 'madeFoul' || r === 'missedFoul';
// A missed shot with a foul isn't charged as a field goal attempt.
const isFieldGoalAttempt = (r: ShotResult) => r !== 'missedFoul';

type Player = { id: string; name: string };
// x: 0..50 ft (left to right), y: 0..94 ft (near baseline up)
type Shot = { id: string; playerId: string; x: number; y: number; result: ShotResult; date: number };
type FreeThrow = { id: string; playerId: string; made: boolean; date: number };
type ReboundKind = 'offensive' | 'defensive';
// Rebounds saved before the split have no kind.
type Rebound = { id: string; playerId: string; kind?: ReboundKind; date: number };

const REBOUND_KINDS: { key: ReboundKind; label: string }[] = [
  { key: 'defensive', label: 'Defensive Rebounds' },
  { key: 'offensive', label: 'Offensive Rebounds' },
];

// Left to right in the Add stat popup.
const POPUP_REBOUNDS: { key: ReboundKind; label: string }[] = [
  { key: 'defensive', label: 'Defensive Rebound' },
  { key: 'offensive', label: 'Offensive Rebound' },
];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const STORAGE_KEY = 'shot-tracker-v1';
const CORRUPT_BACKUP_KEY = 'shot-tracker-v1-corrupt-backup';

// Older saves split misses by who got the rebound.
const migrateShot = (s: Omit<Shot, 'result'> & { result: string }): Shot => ({
  ...s,
  result: s.result === 'missedRebound' || s.result === 'missedNoRebound' ? 'missed' : (s.result as ShotResult),
});

// ---------- Court ----------

type CourtTexture = 'solid' | 'hardwood' | 'parquet';

type CourtColors = {
  court: string;
  secondary: string; // the texture's alternating tone
  texture: CourtTexture;
  line: string;
  make: string;
  makeBorder: string;
  miss: string;
  foul: string;
  hoop: string;
};

const DEFAULT_COLORS: CourtColors = {
  court: '#ecc99e',
  secondary: '#dcb382',
  texture: 'solid',
  line: '#ffffff',
  make: '#2f9e44',
  makeBorder: '#ffffff',
  miss: '#e03131',
  foul: '#fab005',
  hoop: '#e8590c',
};

const COURT_W = 50;
const COURT_H = 94;
const HALF_COURT = COURT_H / 2;
const RIM_X = 25;
const RIM_Y = 5.25; // distance of each rim from its baseline
const THREE_ARC_RADIUS = 23.75;
const THREE_CORNER_X = 3; // distance of the corner three lines from each sideline

// Measured from the near rim, so every shot from the far half counts as a three.
const isThree = (s: Shot) =>
  s.x < THREE_CORNER_X ||
  s.x > COURT_W - THREE_CORNER_X ||
  Math.hypot(s.x - RIM_X, s.y - RIM_Y) >= THREE_ARC_RADIUS;

// Clockwise rotation of the drawn court. Shots are always stored in unrotated court coordinates.
type Rotation = 0 | 90 | 180 | 270;

const ROTATION_TRANSFORMS: Record<Rotation, string> = {
  0: 'translate(0,0) rotate(0)',
  90: `translate(${COURT_H},0) rotate(90)`,
  180: `translate(${COURT_W},${COURT_H}) rotate(180)`,
  270: `translate(0,${COURT_W}) rotate(270)`,
};

// Undoes ROTATION_TRANSFORMS: maps a point on the rotated drawing back to the unrotated drawing.
const unrotate = (vx: number, vy: number, rotation: Rotation): [number, number] => {
  switch (rotation) {
    case 90:
      return [vy, COURT_H - vx];
    case 180:
      return [COURT_W - vx, COURT_H - vy];
    case 270:
      return [COURT_W - vy, vx];
    default:
      return [vx, vy];
  }
};

const fy = (y: number) => COURT_H - y; // flip so baseline is at the bottom

const MAX_ZOOM = 4;
const ZOOM_STEP = 1.5;

// The visible part of the court: zoom level plus the top-left corner, in drawing units.
// At zoom 1 it shows half the court.
type CourtView = { zoom: number; x: number; y: number };

// The near half, wherever the rotation puts it in the drawing.
const defaultView = (rotation: Rotation): CourtView => ({
  zoom: 1,
  x: rotation === 270 ? HALF_COURT : 0,
  y: rotation === 0 ? HALF_COURT : 0,
});

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

const clampView = (
  zoom: number,
  x: number,
  y: number,
  viewW: number,
  viewH: number,
  baseW: number,
  baseH: number,
): CourtView => {
  const z = clamp(zoom, 1, MAX_ZOOM);
  return { zoom: z, x: clamp(x, 0, viewW - baseW / z), y: clamp(y, 0, viewH - baseH / z) };
};

// One half's markings, drawn for the near baseline.
function HalfCourtLines({ line, hoop, sw }: { line: string; hoop: string; sw: number }) {
  return (
    <>
      {/* paint */}
      <Rect x={17} y={fy(19)} width={16} height={19} fill="none" stroke={line} strokeWidth={sw} />
      {/* free throw circle */}
      <Circle cx={25} cy={fy(19)} r={6} fill="none" stroke={line} strokeWidth={sw} />
      {/* backboard + rim */}
      <Line x1={22} y1={fy(4)} x2={28} y2={fy(4)} stroke={line} strokeWidth={sw * 1.5} />
      <Circle cx={25} cy={fy(RIM_Y)} r={0.75} fill="none" stroke={hoop} strokeWidth={sw} />
      {/* restricted area */}
      <Path d={`M 29 ${fy(RIM_Y)} A 4 4 0 0 0 21 ${fy(RIM_Y)}`} fill="none" stroke={line} strokeWidth={sw} />
      {/* three-point line: 3 ft from sideline, 23.75 ft arc from the rim */}
      <Path
        d={`M 3 ${COURT_H} L 3 ${fy(14.2)} A 23.75 23.75 0 0 1 47 ${fy(14.2)} L 47 ${COURT_H}`}
        fill="none"
        stroke={line}
        strokeWidth={sw}
      />
    </>
  );
}

function CourtFrame({
  rotation,
  background,
  line,
  hoop,
  onTap,
  onTouchingChange,
  underLines,
  children,
}: {
  rotation: Rotation;
  background: string;
  line: string;
  hoop: string;
  onTap: (x: number, y: number) => void;
  onTouchingChange: (touching: boolean) => void;
  underLines?: React.ReactNode;
  children?: (zoom: number) => React.ReactNode;
}) {
  const { styles } = useTheme();
  const { width } = useWindowDimensions();
  const sideways = rotation % 180 !== 0;
  // The whole court, and the part of it visible at zoom 1 (half).
  const viewW = sideways ? COURT_H : COURT_W;
  const viewH = sideways ? COURT_W : COURT_H;
  const baseW = sideways ? HALF_COURT : COURT_W;
  const baseH = sideways ? COURT_W : HALF_COURT;
  const w = Math.min(width - 24, 600);
  const h = (w * baseH) / baseW;
  const [view, setView] = useState<CourtView>(() => defaultView(rotation));
  const sw = 0.3 / view.zoom;
  const home = defaultView(rotation);
  const atHome = view.zoom === home.zoom && view.x === home.x && view.y === home.y;

  // Gesture callbacks read the latest values from here.
  const latest = useRef({ view, w, h, viewW, viewH, baseW, baseH, rotation, onTap, onTouchingChange });
  latest.current = { view, w, h, viewW, viewH, baseW, baseH, rotation, onTap, onTouchingChange };
  const pinchStart = useRef<{ zoom: number; focusX: number; focusY: number } | null>(null);
  const activeGestures = useRef(0);

  // While a finger is on the court, the page stops scrolling so dragging moves the court.
  const gestureBegan = () => {
    activeGestures.current += 1;
    latest.current.onTouchingChange(true);
  };
  const gestureEnded = () => {
    activeGestures.current = Math.max(activeGestures.current - 1, 0);
    if (activeGestures.current === 0) latest.current.onTouchingChange(false);
  };

  useEffect(() => setView(defaultView(rotation)), [rotation]);

  const stepZoom = (factor: number) =>
    setView((v) => {
      const z = clamp(v.zoom * factor, 1, MAX_ZOOM);
      // Keep the center of the visible area in place.
      const x = v.x + baseW / v.zoom / 2 - baseW / z / 2;
      const y = v.y + baseH / v.zoom / 2 - baseH / z / 2;
      return clampView(z, x, y, viewW, viewH, baseW, baseH);
    });

  const pinch = usePinchGesture({
    runOnJS: true,
    onBegin: gestureBegan,
    onActivate: (e) => {
      const { view: v, w: pw, h: ph, baseW: bw, baseH: bh } = latest.current;
      pinchStart.current = {
        zoom: v.zoom,
        focusX: v.x + (e.focalX / pw) * (bw / v.zoom),
        focusY: v.y + (e.focalY / ph) * (bh / v.zoom),
      };
    },
    onUpdate: (e) => {
      const start = pinchStart.current;
      if (!start) return;
      const { w: pw, h: ph, viewW: vw, viewH: vh, baseW: bw, baseH: bh } = latest.current;
      // Keep the court point that started under the fingers under them.
      const z = clamp(start.zoom * e.scale, 1, MAX_ZOOM);
      setView(clampView(z, start.focusX - (e.focalX / pw) * (bw / z), start.focusY - (e.focalY / ph) * (bh / z), vw, vh, bw, bh));
    },
    onFinalize: () => {
      pinchStart.current = null;
      gestureEnded();
      const { viewW: vw, viewH: vh, baseW: bw, baseH: bh } = latest.current;
      setView((v) => (v.zoom < 1.05 ? clampView(1, v.x, v.y, vw, vh, bw, bh) : v));
    },
  });
  const pan = usePanGesture({
    runOnJS: true,
    maxPointers: 1,
    onBegin: gestureBegan,
    onUpdate: (e) => {
      if (pinchStart.current) return;
      const { w: pw, h: ph, viewW: vw, viewH: vh, baseW: bw, baseH: bh } = latest.current;
      setView((v) =>
        clampView(v.zoom, v.x - (e.changeX / pw) * (bw / v.zoom), v.y - (e.changeY / ph) * (bh / v.zoom), vw, vh, bw, bh),
      );
    },
    onFinalize: gestureEnded,
  });
  const tap = useTapGesture({
    runOnJS: true,
    onActivate: (e) => {
      const { view: v, w: pw, h: ph, baseW: bw, baseH: bh, rotation: r, onTap: tapped } = latest.current;
      const [cx, cy] = unrotate(v.x + (e.x / pw) * (bw / v.zoom), v.y + (e.y / ph) * (bh / v.zoom), r);
      tapped(clamp(cx, 0, COURT_W), clamp(COURT_H - cy, 0, COURT_H));
    },
  });
  const moves = useSimultaneousGestures(pinch, pan);
  const gesture = useCompetingGestures(moves, tap);

  return (
    <View>
      <GestureDetector gesture={gesture}>
        <View collapsable={false} style={{ width: w, height: h, alignSelf: 'center', borderRadius: 8, overflow: 'hidden' }}>
          <View pointerEvents="none">
            <Svg width={w} height={h} viewBox={`${view.x} ${view.y} ${baseW / view.zoom} ${baseH / view.zoom}`}>
              <G transform={ROTATION_TRANSFORMS[rotation]}>
                <Rect x={0} y={0} width={COURT_W} height={COURT_H} fill={background} />
                {underLines}
                <Rect x={0.15} y={0.15} width={COURT_W - 0.3} height={COURT_H - 0.3} fill="none" stroke={line} strokeWidth={sw} />
                {/* half court line + center circle */}
                <Line x1={0} y1={HALF_COURT} x2={COURT_W} y2={HALF_COURT} stroke={line} strokeWidth={sw} />
                <Circle cx={25} cy={HALF_COURT} r={6} fill="none" stroke={line} strokeWidth={sw} />
                <HalfCourtLines line={line} hoop={hoop} sw={sw} />
                <G transform={`translate(${COURT_W},${COURT_H}) rotate(180)`}>
                  <HalfCourtLines line={line} hoop={hoop} sw={sw} />
                </G>
                {children?.(view.zoom)}
              </G>
            </Svg>
          </View>
        </View>
      </GestureDetector>
      <Text style={[styles.legendText, { textAlign: 'center', marginTop: 8 }]}>Drag the court to see the other half.</Text>
      <View style={styles.zoomBar}>
        <Pressable
          onPress={() => stepZoom(1 / ZOOM_STEP)}
          disabled={view.zoom <= 1}
          style={[styles.undo, styles.zoomBtn, view.zoom <= 1 && { opacity: 0.4 }]}
        >
          <Text style={styles.btnText}>−</Text>
        </Pressable>
        <Text style={styles.zoomLabel}>{Math.round(view.zoom * 100)}%</Text>
        <Pressable
          onPress={() => stepZoom(ZOOM_STEP)}
          disabled={view.zoom >= MAX_ZOOM}
          style={[styles.undo, styles.zoomBtn, view.zoom >= MAX_ZOOM && { opacity: 0.4 }]}
        >
          <Text style={styles.btnText}>+</Text>
        </Pressable>
        <Pressable onPress={() => setView(home)} disabled={atHome} style={[styles.undo, atHome && { opacity: 0.4 }]}>
          <Text style={styles.btnText}>Reset</Text>
        </Pressable>
      </View>
    </View>
  );
}

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

function CourtTextureLayer({ colors }: { colors: CourtColors }) {
  return colors.texture === 'solid' ? null : <Path d={TEXTURE_PATHS[colors.texture]} fill={colors.secondary} />;
}

// m scales the marker, e.g. to keep it the same size on screen while zoomed.
function ShotMarker({ cx, cy, result, m, colors }: { cx: number; cy: number; result: ShotResult; m: number; colors: CourtColors }) {
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

function Court({
  shots,
  rotation,
  colors,
  onTapCourt,
  onTouchingChange,
}: {
  shots: Shot[];
  rotation: Rotation;
  colors: CourtColors;
  onTapCourt: (x: number, y: number) => void;
  onTouchingChange: (touching: boolean) => void;
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
    >
      {(zoom) => shots.map((s) => <ShotMarker key={s.id} cx={s.x} cy={fy(s.y)} result={s.result} m={1 / zoom} colors={colors} />)}
    </CourtFrame>
  );
}

// ---------- Player picker ----------

function PlayerPicker({
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
  const { styles, t } = useTheme();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const submit = () => {
    const n = name.trim();
    if (n) onAdd(n);
    setName('');
    setAdding(false);
  };

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

      <Modal transparent animationType="fade" visible={adding} onRequestClose={() => setAdding(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>New player</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Name"
              placeholderTextColor={t.muted}
              autoFocus
              style={styles.input}
              onSubmitEditing={submit}
              returnKeyType="done"
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Pressable style={[styles.btn, styles.btnGray, { flex: 1 }]} onPress={() => { setName(''); setAdding(false); }}>
                <Text style={styles.btnText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.btnBlue, { flex: 1 }]} onPress={submit}>
                <Text style={[styles.btnText, { color: '#fff' }]}>Add</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---------- Free throws ----------

function FreeThrowPanel({
  playerId,
  freeThrows,
  addFT,
  undoFT,
}: {
  playerId: string;
  freeThrows: FreeThrow[];
  addFT: (playerId: string, made: boolean) => void;
  undoFT: (playerId: string) => void;
}) {
  const { styles } = useTheme();
  const mine = freeThrows.filter((f) => f.playerId === playerId);

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>Free throws</Text>
        <Text style={styles.panelScore}>
          {mine.filter((f) => f.made).length} / {mine.length}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 10 }}>
        <Pressable style={[styles.panelBtn, styles.btnGreen]} onPress={() => addFT(playerId, true)}>
          <Text style={styles.panelBtnText}>Made</Text>
        </Pressable>
        <Pressable style={[styles.panelBtn, styles.btnRed]} onPress={() => addFT(playerId, false)}>
          <Text style={styles.panelBtnText}>Missed</Text>
        </Pressable>
      </View>
      <Pressable
        onPress={() => undoFT(playerId)}
        disabled={mine.length === 0}
        style={[styles.undo, { marginTop: 10, alignSelf: 'flex-end' }, mine.length === 0 && { opacity: 0.4 }]}
      >
        <Text style={styles.btnText}>Undo last free throw</Text>
      </Pressable>
    </View>
  );
}

// ---------- Rebounds ----------

function ReboundPanel({
  playerId,
  rebounds,
  addRebound,
  undoRebound,
}: {
  playerId: string;
  rebounds: Rebound[];
  addRebound: (playerId: string, kind: ReboundKind) => void;
  undoRebound: (playerId: string, kind: ReboundKind) => void;
}) {
  const { styles } = useTheme();
  return (
    <View style={styles.reboundRow}>
      {REBOUND_KINDS.map(({ key, label }) => {
        const count = rebounds.filter((r) => r.playerId === playerId && r.kind === key).length;
        return (
          <View key={key} style={[styles.panel, styles.reboundPanel]}>
            <View style={styles.panelHeader}>
              <Text style={[styles.panelTitle, { flex: 1 }]}>{label}</Text>
              <Text style={styles.panelScore}>{count}</Text>
            </View>
            <View style={{ flexDirection: 'row', marginTop: 10 }}>
              <Pressable style={[styles.panelBtn, styles.btnBlue]} onPress={() => addRebound(playerId, key)}>
                <Text style={styles.panelBtnText}>+ Add</Text>
              </Pressable>
            </View>
            <Pressable
              onPress={() => undoRebound(playerId, key)}
              disabled={count === 0}
              style={[styles.undo, { marginTop: 10, alignItems: 'center' }, count === 0 && { opacity: 0.4 }]}
            >
              <Text style={styles.btnText}>Undo</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

// ---------- Screens ----------

function ShotsScreen(props: {
  players: Player[];
  shots: Shot[];
  freeThrows: FreeThrow[];
  rebounds: Rebound[];
  selected: string | null;
  setSelected: (id: string | null) => void;
  addPlayer: (name: string) => void;
  addShot: (s: Omit<Shot, 'id' | 'date'>) => void;
  undo: (playerId: string | null) => void;
  addFT: (playerId: string, made: boolean) => void;
  undoFT: (playerId: string) => void;
  addRebound: (playerId: string, kind: ReboundKind) => void;
  undoRebound: (playerId: string, kind: ReboundKind) => void;
  rotation: Rotation;
  rotateCourt: () => void;
  colors: CourtColors;
}) {
  const { styles } = useTheme();
  const { players, shots, freeThrows, rebounds, selected, setSelected, addPlayer, addShot, undo, addFT, undoFT, addRebound, undoRebound, rotation, rotateCourt, colors } = props;
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [pendingPlayer, setPendingPlayer] = useState<string | null>(null);
  const [touchingCourt, setTouchingCourt] = useState(false);
  // With "All" selected, the shooter is picked in the popup (or implied if there's only one player).
  const shooter = selected ?? pendingPlayer ?? (players.length === 1 ? players[0].id : null);
  const closePending = () => {
    setPending(null);
    setPendingPlayer(null);
  };
  const visible = useMemo(() => shots.filter((s) => selected === null || s.playerId === selected), [shots, selected]);

  return (
    <View style={{ flex: 1 }}>
      <PlayerPicker players={players} selected={selected} onSelect={setSelected} onAdd={addPlayer} />
      <ScrollView scrollEnabled={!touchingCourt} contentContainerStyle={{ paddingBottom: 16 }}>
        <Court
          shots={visible}
          rotation={rotation}
          colors={colors}
          onTapCourt={(x, y) => {
            if (players.length > 0) setPending({ x, y });
          }}
          onTouchingChange={setTouchingCourt}
        />
        <Text style={styles.hint}>
          {selected
            ? 'Tap the court where the shot was taken.'
            : players.length === 0
            ? 'Add a player to get started.'
            : 'Tap the court to add a shot, or select a player to also record free throws and rebounds.'}
        </Text>
        <View style={styles.legend}>
          <Text style={styles.legendText}>● made   ✕ missed   ○ foul</Text>
          <Pressable onPress={() => undo(selected)} disabled={visible.length === 0} style={[styles.undo, visible.length === 0 && { opacity: 0.4 }]}>
            <Text style={styles.btnText}>Undo last shot</Text>
          </Pressable>
        </View>
        {selected && (
          <>
            <FreeThrowPanel playerId={selected} freeThrows={freeThrows} addFT={addFT} undoFT={undoFT} />
            <ReboundPanel playerId={selected} rebounds={rebounds} addRebound={addRebound} undoRebound={undoRebound} />
          </>
        )}
        <Pressable onPress={rotateCourt} style={[styles.undo, { marginTop: 16, alignSelf: 'center' }]}>
          <Text style={styles.btnText}>Rotate court</Text>
        </Pressable>
      </ScrollView>

      <Modal transparent animationType="fade" visible={pending !== null} onRequestClose={closePending}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Add stat</Text>
            {selected === null && (
              <View style={styles.shooterPicker}>
                {players.map((p) => (
                  <Pressable key={p.id} onPress={() => setPendingPlayer(p.id)} style={[styles.chip, shooter === p.id && styles.chipOn]}>
                    <Text style={[styles.chipText, shooter === p.id && styles.chipTextOn]}>{p.name}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {RESULTS.map((r) => (
              <Pressable
                key={r.key}
                disabled={!shooter}
                style={[styles.btn, isMade(r.key) ? styles.btnGreen : styles.btnRed, { marginTop: 8 }, !shooter && { opacity: 0.4 }]}
                onPress={() => {
                  if (pending && shooter) addShot({ playerId: shooter, x: pending.x, y: pending.y, result: r.key });
                  closePending();
                }}
              >
                <Text style={[styles.btnText, { color: '#fff' }]}>{r.label}</Text>
              </Pressable>
            ))}
            {selected === null && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                {POPUP_REBOUNDS.map(({ key, label }) => (
                  <Pressable
                    key={key}
                    disabled={!shooter}
                    style={[styles.btn, styles.btnBlue, styles.popupReboundBtn, !shooter && { opacity: 0.4 }]}
                    onPress={() => {
                      if (shooter) addRebound(shooter, key);
                      closePending();
                    }}
                  >
                    <Text style={[styles.btnText, { color: '#fff', textAlign: 'center' }]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Pressable style={[styles.btn, styles.btnGray, { marginTop: 12 }]} onPress={closePending}>
              <Text style={styles.btnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const shootingLine = (shots: Shot[]) => {
  const made = shots.filter((x) => isMade(x.result)).length;
  const attempts = shots.filter((x) => isFieldGoalAttempt(x.result)).length;
  const pct = attempts ? ` (${Math.round((100 * made) / attempts)}%)` : '';
  return `${made}/${attempts}${pct}`;
};

const totalPoints = (shots: Shot[], freeThrows: FreeThrow[]) =>
  shots.filter((x) => isMade(x.result)).reduce((sum, x) => sum + (isThree(x) ? 3 : 2), 0) +
  freeThrows.filter((x) => x.made).length;

function StatsScreen({
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

function HeatMapScreen({
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

const COLOR_SWATCHES: { name: string; hex: string }[] = [
  { name: 'Wood', hex: '#ecc99e' },
  { name: 'Medium wood', hex: '#dcb382' },
  { name: 'Dark wood', hex: '#b5835a' },
  { name: 'White', hex: '#ffffff' },
  { name: 'Light gray', hex: '#dee2e6' },
  { name: 'Gray', hex: '#868e96' },
  { name: 'Black', hex: '#212529' },
  { name: 'Green', hex: '#2f9e44' },
  { name: 'Teal', hex: '#0ca678' },
  { name: 'Blue', hex: '#1971c2' },
  { name: 'Navy', hex: '#1c3f6e' },
  { name: 'Purple', hex: '#7048e8' },
  { name: 'Red', hex: '#e03131' },
  { name: 'Orange', hex: '#e8590c' },
  { name: 'Yellow', hex: '#fab005' },
];

const COURT_TEXTURES: { key: CourtTexture; label: string }[] = [
  { key: 'solid', label: 'Solid' },
  { key: 'hardwood', label: 'Hardwood' },
  { key: 'parquet', label: 'Parquet' },
];

const COLOR_SETTINGS: { key: Exclude<keyof CourtColors, 'texture'>; label: string }[] = [
  { key: 'court', label: 'Court Color' },
  { key: 'secondary', label: 'Secondary Color' },
  { key: 'line', label: 'Line Color' },
  { key: 'make', label: 'Makes' },
  { key: 'makeBorder', label: 'Makes Border' },
  { key: 'miss', label: 'Misses' },
  { key: 'foul', label: 'Fouls' },
  { key: 'hoop', label: 'Hoop Color' },
];

function ColorPreview({ colors }: { colors: CourtColors }) {
  return (
    <View style={{ borderRadius: 8, overflow: 'hidden', marginTop: 12 }}>
      <Svg width="100%" height={72} viewBox="0 0 50 12" preserveAspectRatio="xMidYMid slice">
        <Rect x={0} y={0} width={50} height={12} fill={colors.court} />
        <CourtTextureLayer colors={colors} />
        <Line x1={0} y1={10.5} x2={50} y2={10.5} stroke={colors.line} strokeWidth={0.3} />
        <Circle cx={7} cy={5.5} r={1.2} fill="none" stroke={colors.hoop} strokeWidth={0.4} />
        <ShotMarker cx={15} cy={5.5} result="made" m={1} colors={colors} />
        <ShotMarker cx={23} cy={5.5} result="madeFoul" m={1} colors={colors} />
        <ShotMarker cx={31} cy={5.5} result="missed" m={1} colors={colors} />
        <ShotMarker cx={39} cy={5.5} result="missedFoul" m={1} colors={colors} />
      </Svg>
    </View>
  );
}

type ThemeMode = 'light' | 'dark' | 'phone';

const THEME_MODES: { key: ThemeMode; label: string }[] = [
  { key: 'light', label: 'Off' },
  { key: 'dark', label: 'On' },
  { key: 'phone', label: 'Match device' },
];

type SettingsSection = 'display' | 'export';

const SETTINGS_SECTIONS: { key: SettingsSection; label: string }[] = [
  { key: 'display', label: 'Display' },
  { key: 'export', label: 'Export' },
];

function SettingsScreen({
  players,
  shots,
  freeThrows,
  rebounds,
  colors,
  setColors,
  themeMode,
  setThemeMode,
}: {
  players: Player[];
  shots: Shot[];
  freeThrows: FreeThrow[];
  rebounds: Rebound[];
  colors: CourtColors;
  setColors: (colors: CourtColors) => void;
  themeMode: ThemeMode;
  setThemeMode: (themeMode: ThemeMode) => void;
}) {
  const { styles } = useTheme();
  const [section, setSection] = useState<SettingsSection>('display');
  const hasTexture = colors.texture !== 'solid';
  const shownColorSettings = COLOR_SETTINGS.filter(({ key }) => key !== 'secondary' || hasTexture);
  // A make is still visible if only its border blends in, so that doesn't need a warning.
  const hidden = shownColorSettings.filter(
    ({ key }) => key !== 'court' && key !== 'makeBorder' && colors[key] === colors.court,
  );
  const isDefault =
    colors.texture === DEFAULT_COLORS.texture && COLOR_SETTINGS.every(({ key }) => colors[key] === DEFAULT_COLORS[key]);

  const exportData = async () => {
    try {
      await Share.share({ message: JSON.stringify({ players, shots, freeThrows, rebounds }, null, 2) });
    } catch {
      Alert.alert('Export failed', "Couldn't open the share sheet. Please try again.");
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.modeRow, { paddingTop: 8 }]}>
        {SETTINGS_SECTIONS.map(({ key, label }) => (
          <Pressable
            key={key}
            onPress={() => setSection(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: section === key }}
            style={[styles.chip, section === key && styles.chipOn]}
          >
            <Text style={[styles.chipText, section === key && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}>
        {section === 'display' && (
          <View style={[styles.statCard, { marginBottom: 12 }]}>
            <Text style={styles.statName}>Dark Mode</Text>
            <View style={styles.swatchRow}>
              {THEME_MODES.map(({ key, label }) => (
                <Pressable
                  key={key}
                  onPress={() => setThemeMode(key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Dark Mode: ${label}`}
                  accessibilityState={{ selected: themeMode === key }}
                  style={[styles.chip, themeMode === key && styles.chipOn]}
                >
                  <Text style={[styles.chipText, themeMode === key && styles.chipTextOn]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        {section === 'display' && (
          <View style={styles.statCard}>
            <Text style={styles.statName}>Colors</Text>
            <ColorPreview colors={colors} />
            {hidden.length > 0 && (
              <Text style={[styles.warning, { marginTop: 8, borderRadius: 8, overflow: 'hidden' }]}>
                Same as the Court Color, so hard to see: {hidden.map(({ label }) => label).join(', ')}
              </Text>
            )}
            {shownColorSettings.map(({ key, label }) => (
              <View key={key} style={{ marginTop: 14 }}>
                <Text style={styles.statLine}>{label}</Text>
                <View style={styles.swatchRow}>
                  {COLOR_SWATCHES.map(({ name, hex }) => (
                    <Pressable
                      key={hex}
                      onPress={() => setColors({ ...colors, [key]: hex })}
                      accessibilityRole="button"
                      accessibilityLabel={`${label}: ${name}`}
                      accessibilityState={{ selected: colors[key] === hex }}
                      style={[styles.swatchRing, colors[key] === hex && styles.swatchRingOn]}
                    >
                      <View style={[styles.swatch, { backgroundColor: hex }]} />
                    </Pressable>
                  ))}
                </View>
                {key === 'court' && (
                  <>
                    <Text style={[styles.statLine, { marginTop: 14 }]}>Court Texture</Text>
                    <View style={styles.swatchRow}>
                      {COURT_TEXTURES.map((t) => (
                        <Pressable
                          key={t.key}
                          onPress={() => setColors({ ...colors, texture: t.key })}
                          accessibilityRole="button"
                          accessibilityState={{ selected: colors.texture === t.key }}
                          style={[styles.chip, colors.texture === t.key && styles.chipOn]}
                        >
                          <Text style={[styles.chipText, colors.texture === t.key && styles.chipTextOn]}>{t.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                )}
              </View>
            ))}
            <Pressable
              onPress={() => setColors(DEFAULT_COLORS)}
              disabled={isDefault}
              style={[styles.undo, { marginTop: 16, alignItems: 'center' }, isDefault && { opacity: 0.4 }]}
            >
              <Text style={styles.btnText}>Reset colors</Text>
            </Pressable>
          </View>
        )}
        {section === 'export' && (
          <View style={styles.statCard}>
            <Text style={styles.statName}>Export data</Text>
            <Text style={styles.statSmall}>
              Shares all players, shots, free throws and rebounds as JSON text. Save it somewhere safe to keep a copy.
            </Text>
            <Pressable style={[styles.btn, styles.btnBlue, { marginTop: 12 }]} onPress={exportData}>
              <Text style={[styles.btnText, { color: '#fff' }]}>Export data</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ---------- App ----------

type Tab = 'shots' | 'stats' | 'heat' | 'settings';

const TABS: [Tab, string][] = [
  ['shots', 'Shot Chart'],
  ['stats', 'Stats'],
  ['heat', 'Heat Map'],
  ['settings', 'Settings'],
];

const HEAT_ICON_OPACITY = [0.4, 0.6, 1, 0.4, 1, 0.8, 0.6, 0.8, 0.4];

function TabIcon({ tab, color }: { tab: Tab; color: string }) {
  const stroke = { stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const, fill: 'none' };
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24">
      {tab === 'shots' && (
        <>
          <Circle cx={12} cy={12} r={9} {...stroke} />
          <Line x1={3} y1={12} x2={21} y2={12} {...stroke} />
          <Line x1={12} y1={3} x2={12} y2={21} {...stroke} />
          <Path d="M5.6 5.6 C9 8.5 9 15.5 5.6 18.4" {...stroke} />
          <Path d="M18.4 5.6 C15 8.5 15 15.5 18.4 18.4" {...stroke} />
        </>
      )}
      {tab === 'stats' && (
        <>
          <Rect x={4} y={13} width={4} height={7} rx={1} fill={color} />
          <Rect x={10} y={8} width={4} height={12} rx={1} fill={color} />
          <Rect x={16} y={4} width={4} height={16} rx={1} fill={color} />
        </>
      )}
      {tab === 'heat' &&
        HEAT_ICON_OPACITY.map((opacity, i) => (
          <Rect
            key={i}
            x={3 + (i % 3) * 6.5}
            y={3 + Math.floor(i / 3) * 6.5}
            width={5}
            height={5}
            rx={1}
            fill={color}
            opacity={opacity}
          />
        ))}
      {tab === 'settings' && (
        <>
          <Line x1={4} y1={7} x2={20} y2={7} {...stroke} />
          <Circle cx={15} cy={7} r={2.8} fill={color} />
          <Line x1={4} y1={17} x2={20} y2={17} {...stroke} />
          <Circle cx={9} cy={17} r={2.8} fill={color} />
        </>
      )}
    </Svg>
  );
}

export default function App() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [freeThrows, setFreeThrows] = useState<FreeThrow[]>([]);
  const [rebounds, setRebounds] = useState<Rebound[]>([]);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [colors, setColors] = useState<CourtColors>(DEFAULT_COLORS);
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  const phoneScheme = useColorScheme();
  const darkMode = themeMode === 'dark' || (themeMode === 'phone' && phoneScheme === 'dark');
  const theme = darkMode ? DARK_THEME : LIGHT_THEME;
  const { t, styles } = theme;
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('shots');
  const [loaded, setLoaded] = useState(false);
  const [savingBlocked, setSavingBlocked] = useState(false);

  useEffect(() => {
    (async () => {
      let raw: string | null = null;
      try {
        raw = await AsyncStorage.getItem(STORAGE_KEY);
      } catch {
        // The saved data may still be fine, so don't overwrite it this session.
        setSavingBlocked(true);
        setLoaded(true);
        return;
      }
      if (raw) {
        try {
          const d = JSON.parse(raw);
          setPlayers(d.players ?? []);
          setShots((d.shots ?? []).map(migrateShot));
          setFreeThrows(d.freeThrows ?? []);
          setRebounds(d.rebounds ?? []);
          setRotation(d.rotation ?? 0);
          setColors({ ...DEFAULT_COLORS, ...d.colors });
          // Saves from before Match device stored a plain on/off.
          setThemeMode(d.themeMode ?? (d.darkMode ? 'dark' : 'light'));
        } catch {
          // Unreadable data: keep a copy before normal saves replace it.
          await AsyncStorage.setItem(CORRUPT_BACKUP_KEY, raw).catch(() => setSavingBlocked(true));
        }
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded || savingBlocked) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ players, shots, freeThrows, rebounds, rotation, colors, themeMode })).catch(() => {});
  }, [players, shots, freeThrows, rebounds, rotation, colors, themeMode, loaded, savingBlocked]);

  const addPlayer = (name: string) => {
    const p = { id: uid(), name };
    setPlayers((prev) => [...prev, p]);
    setSelected(p.id);
  };
  const addShot = (s: Omit<Shot, 'id' | 'date'>) => setShots((prev) => [...prev, { ...s, id: uid(), date: Date.now() }]);
  const undoShot = (playerId: string | null) =>
    setShots((prev) => {
      const i = playerId === null ? prev.length - 1 : prev.map((s) => s.playerId).lastIndexOf(playerId);
      return i < 0 ? prev : prev.filter((_, idx) => idx !== i);
    });
  const addFT = (playerId: string, made: boolean) =>
    setFreeThrows((prev) => [...prev, { id: uid(), playerId, made, date: Date.now() }]);
  const undoFT = (playerId: string) =>
    setFreeThrows((prev) => {
      const i = prev.map((f) => f.playerId).lastIndexOf(playerId);
      return i < 0 ? prev : prev.filter((_, idx) => idx !== i);
    });
  const addRebound = (playerId: string, kind: ReboundKind) =>
    setRebounds((prev) => [...prev, { id: uid(), playerId, kind, date: Date.now() }]);
  const undoRebound = (playerId: string, kind: ReboundKind) =>
    setRebounds((prev) => {
      const i = prev.map((r) => r.playerId === playerId && r.kind === kind).lastIndexOf(true);
      return i < 0 ? prev : prev.filter((_, idx) => idx !== i);
    });
  const rotateCourt = () => setRotation((prev) => ((prev + 90) % 360) as Rotation);

  if (!loaded) return null;

  return (
    <ThemeContext.Provider value={theme}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <SafeAreaView style={styles.root}>
            <StatusBar style={darkMode ? 'light' : 'dark'} />
            <Text style={styles.title}>{TABS.find(([key]) => key === tab)?.[1]}</Text>
            {savingBlocked && (
              <Text style={styles.warning}>Couldn't access saved data. Changes won't be saved. Restart the app to try again.</Text>
            )}
            <View style={{ flex: 1 }}>
              {tab === 'shots' && (
                <ShotsScreen
                  players={players}
                  shots={shots}
                  freeThrows={freeThrows}
                  rebounds={rebounds}
                  selected={selected}
                  setSelected={setSelected}
                  addPlayer={addPlayer}
                  addShot={addShot}
                  undo={undoShot}
                  addFT={addFT}
                  undoFT={undoFT}
                  addRebound={addRebound}
                  undoRebound={undoRebound}
                  rotation={rotation}
                  rotateCourt={rotateCourt}
                  colors={colors}
                />
              )}
              {tab === 'stats' && <StatsScreen players={players} shots={shots} freeThrows={freeThrows} rebounds={rebounds} />}
              {tab === 'heat' && (
                <HeatMapScreen
                  players={players}
                  shots={shots}
                  selected={selected}
                  setSelected={setSelected}
                  addPlayer={addPlayer}
                  rotation={rotation}
                  rotateCourt={rotateCourt}
                />
              )}
              {tab === 'settings' && (
                <SettingsScreen
                  players={players}
                  shots={shots}
                  freeThrows={freeThrows}
                  rebounds={rebounds}
                  colors={colors}
                  setColors={setColors}
                  themeMode={themeMode}
                  setThemeMode={setThemeMode}
                />
              )}
            </View>
            <View style={styles.tabBar}>
              {TABS.map(([key, label]) => (
                <Pressable
                  key={key}
                  style={[styles.tab, tab === key && styles.tabOn]}
                  onPress={() => setTab(key)}
                  accessibilityRole="tab"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: tab === key }}
                >
                  <TabIcon tab={key} color={tab === key ? t.accent : t.muted} />
                </Pressable>
              ))}
            </View>
          </SafeAreaView>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ThemeContext.Provider>
  );
}

// ---------- Styles ----------

const LIGHT_COLORS = {
  background: '#f8f9fa',
  surface: '#ffffff',
  heading: '#000000',
  text: '#212529',
  muted: '#868e96',
  mutedStrong: '#495057',
  chip: '#e9ecef',
  control: '#dee2e6',
  border: '#ced4da',
  swatchBorder: '#adb5bd',
  accent: '#1971c2',
  backdrop: 'rgba(0,0,0,0.4)',
  heatCourt: '#ffffff',
  heatLine: '#868e96',
  heatHoop: '#343a40',
};

const DARK_COLORS: typeof LIGHT_COLORS = {
  background: '#121416',
  surface: '#1f2326',
  heading: '#f1f3f5',
  text: '#f1f3f5',
  muted: '#adb5bd',
  mutedStrong: '#ced4da',
  chip: '#2b3035',
  control: '#343a40',
  border: '#495057',
  swatchBorder: '#868e96',
  accent: '#4dabf7',
  backdrop: 'rgba(0,0,0,0.6)',
  heatCourt: '#343a40',
  heatLine: '#ffffff',
  heatHoop: '#ffffff',
};

const makeStyles = (t: typeof LIGHT_COLORS) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.background },
    title: { fontSize: 20, fontWeight: '700', textAlign: 'center', paddingVertical: 8, color: t.heading },
    warning: { backgroundColor: '#fff3bf', color: '#212529', textAlign: 'center', padding: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: t.chip },
    chipOn: { backgroundColor: '#1971c2' },
    chipAdd: { backgroundColor: t.control },
    chipText: { fontSize: 15, color: t.text },
    chipTextOn: { color: '#fff', fontWeight: '600' },
    hint: { textAlign: 'center', color: t.muted, marginTop: 12, paddingHorizontal: 16 },
    legend: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginTop: 10 },
    legendText: { color: t.mutedStrong },
    zoomBar: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 10 },
    zoomBtn: { width: 44, alignItems: 'center' },
    zoomLabel: { width: 52, textAlign: 'center', color: t.mutedStrong },
    modeRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingBottom: 10 },
    heatLegend: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 2, marginTop: 12 },
    heatSwatch: { width: 24, height: 12, borderRadius: 2 },
    undo: { backgroundColor: t.control, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
    backdrop: { flex: 1, backgroundColor: t.backdrop, justifyContent: 'center', padding: 24 },
    card: { backgroundColor: t.surface, borderRadius: 14, padding: 16 },
    cardTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center', color: t.heading },
    shooterPicker: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 12, marginBottom: 4 },
    input: { borderWidth: 1, borderColor: t.border, borderRadius: 8, padding: 10, fontSize: 16, marginTop: 12, color: t.text },
    btn: { paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
    btnText: { fontSize: 16, fontWeight: '600', color: t.text },
    btnGray: { backgroundColor: t.chip },
    btnBlue: { backgroundColor: '#1971c2' },
    btnGreen: { backgroundColor: '#2f9e44' },
    btnRed: { backgroundColor: '#e03131' },
    panel: { marginTop: 16, marginHorizontal: 12, padding: 14, backgroundColor: t.surface, borderRadius: 12 },
    popupReboundBtn: { flex: 1, justifyContent: 'center', paddingHorizontal: 8 },
    reboundRow: { flexDirection: 'row', gap: 12, marginTop: 16, marginHorizontal: 12 },
    reboundPanel: { flex: 1, marginTop: 0, marginHorizontal: 0 },
    panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    panelTitle: { fontSize: 18, fontWeight: '700', color: t.heading },
    panelScore: { fontSize: 24, fontWeight: '800', color: t.heading },
    panelBtn: { flex: 1, height: 64, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    panelBtnText: { fontSize: 20, fontWeight: '700', color: '#fff' },
    swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
    swatchRing: { padding: 2, borderRadius: 19, borderWidth: 2, borderColor: 'transparent' },
    swatchRingOn: { borderColor: t.accent },
    swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: t.swatchBorder },
    statCard: { backgroundColor: t.surface, borderRadius: 12, padding: 14 },
    statName: { fontSize: 18, fontWeight: '700', marginBottom: 4, color: t.heading },
    statLine: { fontSize: 16, marginTop: 2, color: t.heading },
    statSmall: { fontSize: 13, color: t.muted, marginTop: 6 },
    tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border, backgroundColor: t.surface },
    tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderTopWidth: 2, borderTopColor: 'transparent' },
    tabOn: { borderTopColor: t.accent },
  });

const LIGHT_THEME = { t: LIGHT_COLORS, styles: makeStyles(LIGHT_COLORS) };
const DARK_THEME = { t: DARK_COLORS, styles: makeStyles(DARK_COLORS) };

const ThemeContext = createContext(LIGHT_THEME);
function useTheme() {
  return useContext(ThemeContext);
}
