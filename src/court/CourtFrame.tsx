import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import Svg, { G, Rect, Circle, Line, Path } from 'react-native-svg';
import {
  GestureDetector,
  useCompetingGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';

import { useTheme } from '../theme';
import {
  COURT_W,
  COURT_H,
  HALF_COURT,
  RIM_Y,
  type Rotation,
  ROTATION_TRANSFORMS,
  unrotate,
  fy,
  clamp,
} from './geometry';

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
export function HalfCourtLines({ line, hoop, sw }: { line: string; hoop: string; sw: number }) {
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

export function CourtFrame({
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
