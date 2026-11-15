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
  Keyboard,
  useColorScheme,
  useWindowDimensions,
} from 'react-native';
import Svg, { G, Rect, Circle, Line, Path, Text as SvgText } from 'react-native-svg';
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
// At zoom 1 it shows half the court, or as much as fits when filling the screen.
type CourtView = { zoom: number; x: number; y: number };

// Against the near baseline, wherever the rotation puts it in the drawing, centered across the court.
const defaultView = (rotation: Rotation, viewW: number, viewH: number, baseW: number, baseH: number): CourtView => ({
  zoom: 1,
  x: rotation === 270 ? viewW - baseW : rotation === 90 ? 0 : (viewW - baseW) / 2,
  y: rotation === 0 ? viewH - baseH : rotation === 180 ? 0 : (viewH - baseH) / 2,
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
  fill = false,
  children,
}: {
  rotation: Rotation;
  background: string;
  line: string;
  hoop: string;
  onTap: (x: number, y: number) => void;
  onTouchingChange: (touching: boolean) => void;
  underLines?: React.ReactNode;
  // Fill the parent's space instead of showing half the court at the screen's width.
  fill?: boolean;
  children?: (zoom: number) => React.ReactNode;
}) {
  const { styles } = useTheme();
  const { width } = useWindowDimensions();
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const sideways = rotation % 180 !== 0;
  // The whole court, and the part of it visible at zoom 1.
  const viewW = sideways ? COURT_H : COURT_W;
  const viewH = sideways ? COURT_W : COURT_H;
  let w: number, h: number, baseW: number, baseH: number;
  if (fill) {
    // As much of the court as the area's shape allows, up to all of it.
    w = area?.width ?? 1;
    h = area?.height ?? 1;
    const aspect = w / h;
    baseW = Math.min(viewW, viewH * aspect);
    baseH = baseW / aspect;
  } else {
    baseW = sideways ? HALF_COURT : COURT_W;
    baseH = sideways ? COURT_W : HALF_COURT;
    w = Math.min(width - 24, 600);
    h = (w * baseH) / baseW;
  }
  const home = defaultView(rotation, viewW, viewH, baseW, baseH);
  const [view, setView] = useState<CourtView>(home);
  const sw = 0.3 / view.zoom;
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

  useEffect(() => setView(home), [rotation, baseW, baseH]);

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

  const court = (
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
  );

  return (
    <View style={fill && { flex: 1 }}>
      {fill ? (
        <View style={{ flex: 1 }} onLayout={(e) => setArea({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
          {area && court}
        </View>
      ) : (
        <>
          {court}
          <Text style={[styles.legendText, { textAlign: 'center', marginTop: 8 }]}>Drag the court to see the other half.</Text>
        </>
      )}
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

function NamePrompt({
  visible,
  title,
  placeholder,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  placeholder: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const { styles, t } = useTheme();
  const [name, setName] = useState('');

  const close = () => {
    setName('');
    onClose();
  };
  const submit = () => {
    const n = name.trim();
    if (n) onSubmit(n);
    close();
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{title}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={placeholder}
            placeholderTextColor={t.muted}
            autoFocus
            style={styles.input}
            onSubmitEditing={submit}
            returnKeyType="done"
          />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Pressable style={[styles.btn, styles.btnGray, { flex: 1 }]} onPress={close}>
              <Text style={styles.btnText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnBlue, { flex: 1 }]} onPress={submit}>
              <Text style={[styles.btnText, { color: '#fff' }]}>Add</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
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
  const [fullScreen, setFullScreen] = useState(false);
  // With "All" selected, the shooter is picked in the popup (or implied if there's only one player).
  const shooter = selected ?? pendingPlayer ?? (players.length === 1 ? players[0].id : null);
  const closePending = () => {
    setPending(null);
    setPendingPlayer(null);
  };
  const visible = useMemo(() => shots.filter((s) => selected === null || s.playerId === selected), [shots, selected]);
  const onTapCourt = (x: number, y: number) => {
    if (players.length > 0) setPending({ x, y });
  };

  // Inside the full screen view while it's open, since a popup can't show over it from outside.
  const addStat = (
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
  );

  return (
    <View style={{ flex: 1 }}>
      <PlayerPicker players={players} selected={selected} onSelect={setSelected} onAdd={addPlayer} />
      <ScrollView scrollEnabled={!touchingCourt} contentContainerStyle={{ paddingBottom: 16 }}>
        <Court shots={visible} rotation={rotation} colors={colors} onTapCourt={onTapCourt} onTouchingChange={setTouchingCourt} />
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
        <View style={styles.courtActions}>
          <Pressable onPress={rotateCourt} style={styles.undo}>
            <Text style={styles.btnText}>Rotate court</Text>
          </Pressable>
          {selected === null && (
            <Pressable onPress={() => setFullScreen(true)} style={styles.undo}>
              <Text style={styles.btnText}>Full screen</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

      {!fullScreen && addStat}

      <Modal animationType="fade" visible={fullScreen} onRequestClose={() => setFullScreen(false)}>
        {/* A modal is its own native view tree, so gestures and safe areas need their own roots. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider>
            <SafeAreaView style={styles.root}>
              <View style={styles.fullScreenBar}>
                <Pressable onPress={rotateCourt} style={styles.undo}>
                  <Text style={styles.btnText}>Rotate court</Text>
                </Pressable>
                <Pressable onPress={() => setFullScreen(false)} style={[styles.btn, styles.btnBlue, { paddingHorizontal: 14, paddingVertical: 10 }]}>
                  <Text style={[styles.btnText, { color: '#fff' }]}>Exit full screen</Text>
                </Pressable>
              </View>
              <View style={{ flex: 1, paddingHorizontal: 8, paddingBottom: 8 }}>
                <Court shots={visible} rotation={rotation} colors={colors} onTapCourt={onTapCourt} onTouchingChange={() => {}} fill />
              </View>
            </SafeAreaView>
          </SafeAreaProvider>
          {fullScreen && addStat}
        </GestureHandlerRootView>
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

// ---------- Shot practice ----------

type PracticeSpot = 'shortCorner' | 'corner' | 'elbow' | 'freeThrow' | 'topOfKey' | 'wing' | 'slot' | 'block';

type PracticeLocation = { id: string; name: string; customShots: { id: string; name: string }[] };
// shot is a PracticeShot id, or the id of one of the location's custom shots.
type PracticeSession = { id: string; locationId: string; shot: string; made: number; attempts: number; date: number };

// x, y in court feet like shots, for the right side. Spots off the middle are mirrored onto the left side.
// Labels sit toward half court from the spot, or toward the baseline if `below`; `edge` labels hug the sideline.
const PRACTICE_SPOTS: { key: PracticeSpot; label: string; short: string; x: number; y: number; below?: boolean; edge?: boolean }[] = [
  { key: 'shortCorner', label: 'Short Corner', short: 'Short corner', x: 9, y: 3.5, below: true },
  { key: 'corner', label: 'Corner', short: 'Corner', x: 1.5, y: 4, edge: true },
  { key: 'elbow', label: 'Elbow (High Post)', short: 'Elbow', x: 17, y: 19 },
  { key: 'freeThrow', label: 'Free Throw', short: 'Free throw', x: 25, y: 19 },
  { key: 'topOfKey', label: 'Top of the Key', short: 'Top of key', x: 25, y: 30.5 },
  { key: 'wing', label: 'Wing', short: 'Wing', x: 7.5, y: 22 },
  { key: 'slot', label: 'Slot', short: 'Slot', x: 15.4, y: 28.3 },
  { key: 'block', label: 'Block (Low Post)', short: 'Block', x: 15, y: 7 },
];

type CourtSide = 'left' | 'right';

// Sides are as the shooter sees them facing the basket: left is the high-x side of the court.
const sideAt = (x: number): CourtSide => (x > RIM_X ? 'left' : 'right');

// Spots off the middle are stored separately for each side, e.g. "corner-left".
const practiceShotId = (spot: PracticeSpot, side: CourtSide | null) => (side ? `${spot}-${side}` : spot);

const PRACTICE_SHOTS: { id: string; name: string }[] = PRACTICE_SPOTS.flatMap(({ key, label, x }) =>
  x === RIM_X
    ? [{ id: key, name: label }]
    : [
        { id: practiceShotId(key, 'left'), name: `Left ${label}` },
        { id: practiceShotId(key, 'right'), name: `Right ${label}` },
      ],
);

// Applies ROTATION_TRANSFORMS to a point on the unrotated drawing.
const rotatePoint = (x: number, y: number, rotation: Rotation): [number, number] => {
  switch (rotation) {
    case 90:
      return [COURT_H - y, x];
    case 180:
      return [COURT_W - x, COURT_H - y];
    case 270:
      return [y, COURT_W - x];
    default:
      return [x, y];
  }
};

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

const practiceLine = (list: PracticeSession[]) => {
  const made = list.reduce((sum, s) => sum + s.made, 0);
  const attempts = list.reduce((sum, s) => sum + s.attempts, 0);
  const pct = attempts ? ` (${Math.round((100 * made) / attempts)}%)` : '';
  return `${made}/${attempts}${pct}`;
};

const formatDate = (date: number) =>
  new Date(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

function PracticeCourt({
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

function LocationPicker({
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

const startOfDay = (date: number) => new Date(date).setHours(0, 0, 0, 0);

const addDays = (date: number, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.getTime();
};

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// A month grid of days; days after today can't be picked.
function CalendarPicker({ value, onChange }: { value: number; onChange: (day: number) => void }) {
  const { styles } = useTheme();
  const [month, setMonth] = useState(() => new Date(value).setDate(1));
  const m = new Date(month);
  const today = startOfDay(Date.now());
  const thisMonth = new Date(today).setDate(1);
  const daysInMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const cells = [
    ...Array<null>(m.getDay()).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(m.getFullYear(), m.getMonth(), i + 1).getTime()),
  ];
  const stepMonth = (step: number) => setMonth(new Date(m.getFullYear(), m.getMonth() + step, 1).getTime());

  return (
    <View style={{ marginTop: 8 }}>
      <View style={styles.calendarHeader}>
        <Pressable onPress={() => stepMonth(-1)} accessibilityLabel="Previous month" style={styles.calendarNav}>
          <Text style={styles.btnText}>‹</Text>
        </Pressable>
        <Text style={styles.btnText}>{m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
        <Pressable
          onPress={() => stepMonth(1)}
          disabled={month >= thisMonth}
          accessibilityLabel="Next month"
          style={[styles.calendarNav, month >= thisMonth && { opacity: 0.3 }]}
        >
          <Text style={styles.btnText}>›</Text>
        </Pressable>
      </View>
      <View style={styles.calendarGrid}>
        {WEEKDAY_LETTERS.map((d, i) => (
          <View key={`weekday-${i}`} style={styles.calendarCell}>
            <Text style={styles.statSmall}>{d}</Text>
          </View>
        ))}
        {cells.map((day, i) =>
          day === null ? (
            <View key={`blank-${i}`} style={styles.calendarCell} />
          ) : (
            <Pressable
              key={day}
              onPress={() => onChange(day)}
              disabled={day > today}
              accessibilityRole="button"
              accessibilityLabel={formatDate(day)}
              accessibilityState={{ selected: day === value }}
              style={styles.calendarCell}
            >
              <View style={[styles.calendarDay, day === value && styles.calendarDayOn, day > today && { opacity: 0.3 }]}>
                <Text style={[styles.chipText, day === value && styles.chipTextOn]}>{new Date(day).getDate()}</Text>
              </View>
            </Pressable>
          ),
        )}
      </View>
    </View>
  );
}

function ShotPracticeScreen({
  locations,
  sessions,
  selected,
  setSelected,
  addLocation,
  deleteLocation,
  addCustomShot,
  deleteCustomShot,
  addSession,
  deleteSession,
  colors,
  rotation,
  rotateCourt,
}: {
  locations: PracticeLocation[];
  sessions: PracticeSession[];
  selected: string | null;
  setSelected: (id: string) => void;
  addLocation: (name: string) => void;
  deleteLocation: (id: string) => void;
  addCustomShot: (locationId: string, name: string) => string;
  deleteCustomShot: (locationId: string, shotId: string) => void;
  addSession: (s: Omit<PracticeSession, 'id'>) => void;
  deleteSession: (id: string) => void;
  colors: CourtColors;
  rotation: Rotation;
  rotateCourt: () => void;
}) {
  const { styles, t } = useTheme();
  const [shot, setShot] = useState<string | null>(null);
  const [addingLocation, setAddingLocation] = useState(false);
  const [addingShot, setAddingShot] = useState(false);
  const [entering, setEntering] = useState(false);
  const [made, setMade] = useState('');
  const [attempts, setAttempts] = useState('');
  const [day, setDay] = useState(() => startOfDay(Date.now()));
  const [pickingDay, setPickingDay] = useState(false);

  const location = locations.find((l) => l.id === selected) ?? locations[0];
  const here = useMemo(() => sessions.filter((s) => s.locationId === location?.id), [sessions, location]);
  const shotOptions = [...PRACTICE_SHOTS, ...(location?.customShots ?? [])];
  const current = shotOptions.find((s) => s.id === shot);
  const history = current ? here.filter((s) => s.shot === current.id).sort((a, b) => b.date - a.date) : [];
  const practiced = shotOptions.filter((s) => here.some((x) => x.shot === s.id));

  const complete = /^\d+$/.test(made) && /^\d+$/.test(attempts);
  const tooMany = complete && Number(made) > Number(attempts);
  const canSave = complete && Number(attempts) > 0 && !tooMany;

  const toggleShot = (id: string) => setShot((prev) => (prev === id ? null : id));
  const openEntry = () => {
    setDay(startOfDay(Date.now()));
    setEntering(true);
  };
  const closeEntry = () => {
    setEntering(false);
    setPickingDay(false);
    setMade('');
    setAttempts('');
  };
  const save = () => {
    if (!canSave || !location || !current) return;
    // Today keeps the current time; an earlier day is saved at noon.
    const date = day === startOfDay(Date.now()) ? Date.now() : day + 12 * 60 * 60 * 1000;
    addSession({ locationId: location.id, shot: current.id, made: Number(made), attempts: Number(attempts), date });
    closeEntry();
  };

  const confirmDelete = (title: string, message: string | undefined, onDelete: () => void) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  const resultsNote = (count: number) =>
    count ? `This also deletes its ${count} saved result${count === 1 ? '' : 's'}.` : undefined;

  return (
    <View style={{ flex: 1 }}>
      <LocationPicker
        locations={locations}
        selected={location}
        onSelect={setSelected}
        onAdd={() => setAddingLocation(true)}
        onLongPress={(l) =>
          confirmDelete(`Delete ${l.name}?`, resultsNote(sessions.filter((s) => s.locationId === l.id).length), () =>
            deleteLocation(l.id),
          )
        }
      />

      {!location ? (
        <Text style={styles.hint}>Add a location, like "Home Driveway" or "School court", to get started.</Text>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>
          <PracticeCourt colors={colors} rotation={rotation} selected={shot} onSelect={toggleShot} />
          <Pressable onPress={rotateCourt} style={[styles.undo, { marginTop: 10, alignSelf: 'center' }]}>
            <Text style={styles.btnText}>Rotate court</Text>
          </Pressable>
          <View style={styles.shotChips}>
            {shotOptions.map((s) => {
              const custom = !PRACTICE_SHOTS.some(({ id }) => id === s.id);
              return (
                <Pressable
                  key={s.id}
                  onPress={() => toggleShot(s.id)}
                  onLongPress={
                    custom
                      ? () =>
                          confirmDelete(`Delete ${s.name}?`, resultsNote(here.filter((x) => x.shot === s.id).length), () => {
                            deleteCustomShot(location.id, s.id);
                            if (shot === s.id) setShot(null);
                          })
                      : undefined
                  }
                  accessibilityRole="button"
                  accessibilityState={{ selected: shot === s.id }}
                  style={[styles.chip, shot === s.id && styles.chipOn]}
                >
                  <Text style={[styles.chipText, shot === s.id && styles.chipTextOn]}>{s.name}</Text>
                </Pressable>
              );
            })}
            <Pressable onPress={() => setAddingShot(true)} style={[styles.chip, styles.chipAdd]}>
              <Text style={styles.chipText}>+ Custom shot</Text>
            </Pressable>
          </View>

          {current ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>{current.name}</Text>
              <Text style={styles.statLine}>Total {practiceLine(history)}</Text>
              <Pressable style={[styles.btn, styles.btnBlue, { marginTop: 12 }]} onPress={openEntry}>
                <Text style={[styles.btnText, { color: '#fff' }]}>+ Add results</Text>
              </Pressable>
              {history.length === 0 && <Text style={styles.statSmall}>No results yet at {location.name}.</Text>}
              {history.map((s) => (
                <View key={s.id} style={styles.practiceRow}>
                  <Text style={[styles.statLine, { flex: 1 }]}>{formatDate(s.date)}</Text>
                  <Text style={styles.statLine}>{practiceLine([s])}</Text>
                  <Pressable
                    onPress={() => confirmDelete('Delete this result?', undefined, () => deleteSession(s.id))}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete result from ${formatDate(s.date)}`}
                    style={{ paddingLeft: 14 }}
                  >
                    <Text style={styles.legendText}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>{location.name}</Text>
              {practiced.length === 0 && (
                <Text style={styles.statSmall}>Tap a spot on the court or pick a shot to log your makes and attempts.</Text>
              )}
              {practiced.map((s) => (
                <Pressable key={s.id} onPress={() => setShot(s.id)} style={styles.practiceRow}>
                  <Text style={[styles.statLine, { flex: 1 }]}>{s.name}</Text>
                  <Text style={styles.statLine}>{practiceLine(here.filter((x) => x.shot === s.id))}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Text style={styles.hint}>Long-press a location or custom shot to delete it.</Text>
        </ScrollView>
      )}

      <NamePrompt
        visible={addingLocation}
        title="New location"
        placeholder="e.g. Park by my house"
        onSubmit={addLocation}
        onClose={() => setAddingLocation(false)}
      />
      <NamePrompt
        visible={addingShot}
        title="Custom shot"
        placeholder="e.g. Left-hand floater"
        onSubmit={(name) => location && setShot(addCustomShot(location.id, name))}
        onClose={() => setAddingShot(false)}
      />
      <Modal transparent animationType="fade" visible={entering && current !== undefined} onRequestClose={closeEntry}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{current?.name}</Text>
            <Text style={[styles.statSmall, { textAlign: 'center' }]}>{location?.name}</Text>
            <Text style={styles.statSmall}>Date</Text>
            <Pressable
              onPress={() => {
                Keyboard.dismiss();
                setPickingDay((prev) => !prev);
              }}
              accessibilityRole="button"
              accessibilityState={{ expanded: pickingDay }}
              style={[styles.input, styles.dateButton]}
            >
              <Text style={styles.chipText}>{day === startOfDay(Date.now()) ? `Today, ${formatDate(day)}` : formatDate(day)}</Text>
              <Text style={styles.legendText}>{pickingDay ? '▴' : '▾'}</Text>
            </Pressable>
            {pickingDay && (
              <CalendarPicker
                value={day}
                onChange={(d) => {
                  setDay(d);
                  setPickingDay(false);
                }}
              />
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.statSmall}>Made</Text>
                <TextInput
                  value={made}
                  onChangeText={setMade}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={t.muted}
                  autoFocus
                  onFocus={() => setPickingDay(false)}
                  style={styles.input}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.statSmall}>Attempts</Text>
                <TextInput
                  value={attempts}
                  onChangeText={setAttempts}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={t.muted}
                  onFocus={() => setPickingDay(false)}
                  style={styles.input}
                  onSubmitEditing={save}
                  returnKeyType="done"
                />
              </View>
            </View>
            {tooMany && <Text style={[styles.statSmall, { color: '#e03131' }]}>Made can't be more than attempts.</Text>}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Pressable style={[styles.btn, styles.btnGray, { flex: 1 }]} onPress={closeEntry}>
                <Text style={styles.btnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.btnBlue, { flex: 1 }, !canSave && { opacity: 0.4 }]}
                onPress={save}
                disabled={!canSave}
              >
                <Text style={[styles.btnText, { color: '#fff' }]}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---------- Practice charts ----------

type ChartRange = 'week' | 'month' | 'year' | 'all';

const CHART_RANGES: { key: ChartRange; label: string; summary: string }[] = [
  { key: 'week', label: '1 Week', summary: 'Last 7 days' },
  { key: 'month', label: '1 Month', summary: 'Last 30 days' },
  { key: 'year', label: '1 Year', summary: 'Last 12 months' },
  { key: 'all', label: 'All Time', summary: 'All time' },
];

// How much time each point on the chart covers.
type ChartBucket = 'day' | 'week' | 'month';

const bucketStart = (date: number, bucket: ChartBucket) => {
  const d = new Date(startOfDay(date));
  if (bucket === 'week') d.setDate(d.getDate() - d.getDay());
  if (bucket === 'month') d.setDate(1);
  return d.getTime();
};

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

const axisLabel = (start: number, bucket: ChartBucket) =>
  new Date(start).toLocaleDateString(undefined, bucket === 'month' ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' });

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

// A round number at least n, for the top of the attempts axis.
const niceMax = (n: number) => {
  const p = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 5, 10].map((m) => m * p).find((v) => v >= n) ?? n;
};

const CHART_H = 220;
const CHART_PAD = { left: 40, right: 36, top: 10, bottom: 24 };
const PCT_TICKS = [0, 0.25, 0.5, 0.75, 1];

type ChartSeries = { id: string; color: string; points: { i: number; pct: number }[] };

function PracticeChart({
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

function PracticeChartsScreen({
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
  practiceLocations,
  practiceSessions,
  colors,
  setColors,
  themeMode,
  setThemeMode,
}: {
  players: Player[];
  shots: Shot[];
  freeThrows: FreeThrow[];
  rebounds: Rebound[];
  practiceLocations: PracticeLocation[];
  practiceSessions: PracticeSession[];
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
      await Share.share({ message: JSON.stringify({ players, shots, freeThrows, rebounds, practiceLocations, practiceSessions }, null, 2) });
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
              Shares all players, shots, free throws, rebounds and shot practice results as JSON text. Save it somewhere safe to keep a copy.
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

type Tab = 'shots' | 'stats' | 'heat' | 'practice' | 'practiceCharts' | 'settings';

const TABS: [Tab, string][] = [
  ['shots', 'Shot Chart'],
  ['stats', 'Stats'],
  ['heat', 'Heat Map'],
  ['practice', 'Shot Practice'],
  ['practiceCharts', 'Practice Charts'],
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
      {tab === 'practice' && (
        <>
          <Circle cx={12} cy={12} r={9} {...stroke} />
          <Circle cx={12} cy={12} r={5} {...stroke} />
          <Circle cx={12} cy={12} r={1.8} fill={color} />
        </>
      )}
      {tab === 'practiceCharts' && (
        <>
          <Path d="M3 4 V20 H21" {...stroke} />
          <Path d="M6.5 15 L11 10 L14.5 13 L20 7" {...stroke} strokeLinejoin="round" />
        </>
      )}
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
  const [practiceLocations, setPracticeLocations] = useState<PracticeLocation[]>([]);
  const [practiceSessions, setPracticeSessions] = useState<PracticeSession[]>([]);
  const [practiceLocation, setPracticeLocation] = useState<string | null>(null);
  // Starts with the basket at the top, so the shooter's left is on the left of the screen.
  const [practiceRotation, setPracticeRotation] = useState<Rotation>(180);
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
          setPracticeLocations(d.practiceLocations ?? []);
          setPracticeSessions(d.practiceSessions ?? []);
          setPracticeRotation(d.practiceRotation ?? 180);
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
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        players,
        shots,
        freeThrows,
        rebounds,
        practiceLocations,
        practiceSessions,
        rotation,
        practiceRotation,
        colors,
        themeMode,
      }),
    ).catch(() => {});
  }, [players, shots, freeThrows, rebounds, practiceLocations, practiceSessions, rotation, practiceRotation, colors, themeMode, loaded, savingBlocked]);

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
  const addLocation = (name: string) => {
    const l = { id: uid(), name, customShots: [] };
    setPracticeLocations((prev) => [...prev, l]);
    setPracticeLocation(l.id);
  };
  const deleteLocation = (id: string) => {
    setPracticeLocations((prev) => prev.filter((l) => l.id !== id));
    setPracticeSessions((prev) => prev.filter((s) => s.locationId !== id));
  };
  const addCustomShot = (locationId: string, name: string) => {
    const id = uid();
    setPracticeLocations((prev) =>
      prev.map((l) => (l.id === locationId ? { ...l, customShots: [...l.customShots, { id, name }] } : l)),
    );
    return id;
  };
  const deleteCustomShot = (locationId: string, shotId: string) => {
    setPracticeLocations((prev) =>
      prev.map((l) => (l.id === locationId ? { ...l, customShots: l.customShots.filter((c) => c.id !== shotId) } : l)),
    );
    setPracticeSessions((prev) => prev.filter((s) => s.locationId !== locationId || s.shot !== shotId));
  };
  const addPracticeSession = (s: Omit<PracticeSession, 'id'>) => setPracticeSessions((prev) => [...prev, { ...s, id: uid() }]);
  const deletePracticeSession = (id: string) => setPracticeSessions((prev) => prev.filter((s) => s.id !== id));
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
              {tab === 'practice' && (
                <ShotPracticeScreen
                  locations={practiceLocations}
                  sessions={practiceSessions}
                  selected={practiceLocation}
                  setSelected={setPracticeLocation}
                  addLocation={addLocation}
                  deleteLocation={deleteLocation}
                  addCustomShot={addCustomShot}
                  deleteCustomShot={deleteCustomShot}
                  addSession={addPracticeSession}
                  deleteSession={deletePracticeSession}
                  colors={colors}
                  rotation={practiceRotation}
                  rotateCourt={() => setPracticeRotation((prev) => ((prev + 90) % 360) as Rotation)}
                />
              )}
              {tab === 'practiceCharts' && (
                <PracticeChartsScreen
                  locations={practiceLocations}
                  sessions={practiceSessions}
                  selected={practiceLocation}
                  setSelected={setPracticeLocation}
                />
              )}
              {tab === 'settings' && (
                <SettingsScreen
                  players={players}
                  shots={shots}
                  freeThrows={freeThrows}
                  rebounds={rebounds}
                  practiceLocations={practiceLocations}
                  practiceSessions={practiceSessions}
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
  grid: '#e9ecef',
  bar: '#ced4da',
  // Chart series, in this order so neighbors stay distinguishable with color blindness.
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
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
  grid: '#2b3035',
  bar: '#495057',
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
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
    courtActions: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 16 },
    fullScreenBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 8 },
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
    shotChips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 12, paddingHorizontal: 12 },
    practiceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      marginTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border,
    },
    calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    calendarNav: { paddingHorizontal: 14, paddingVertical: 6 },
    calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
    calendarCell: { width: `${100 / 7}%`, height: 38, alignItems: 'center', justifyContent: 'center' },
    calendarDay: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    calendarDayOn: { backgroundColor: '#1971c2' },
    dateButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    chartCard: { backgroundColor: t.surface, borderRadius: 12, paddingVertical: 10, marginHorizontal: 12, alignItems: 'center' },
    chartAxisTitles: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', paddingHorizontal: 12 },
    seriesChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    seriesDot: { width: 10, height: 10, borderRadius: 5 },
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
