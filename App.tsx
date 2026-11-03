import React, { useEffect, useMemo, useState } from 'react';
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
  useWindowDimensions,
} from 'react-native';
import Svg, { G, Rect, Circle, Line, Path } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

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
// x: 0..50 ft (left to right), y: 0..47 ft (baseline up)
type Shot = { id: string; playerId: string; x: number; y: number; result: ShotResult; date: number };
type FreeThrow = { id: string; playerId: string; made: boolean; date: number };
type Rebound = { id: string; playerId: string; date: number };

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const STORAGE_KEY = 'shot-tracker-v1';
const CORRUPT_BACKUP_KEY = 'shot-tracker-v1-corrupt-backup';

// Older saves split misses by who got the rebound.
const migrateShot = (s: Omit<Shot, 'result'> & { result: string }): Shot => ({
  ...s,
  result: s.result === 'missedRebound' || s.result === 'missedNoRebound' ? 'missed' : (s.result as ShotResult),
});

// ---------- Court ----------

const COURT_W = 50;
const COURT_H = 47;
const RIM_X = 25;
const RIM_Y = 5.25;
const THREE_ARC_RADIUS = 23.75;
const THREE_CORNER_X = 3; // distance of the corner three lines from each sideline

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

function Court({
  shots,
  rotation,
  onTapCourt,
}: {
  shots: Shot[];
  rotation: Rotation;
  onTapCourt: (x: number, y: number) => void;
}) {
  const { width } = useWindowDimensions();
  const sideways = rotation % 180 !== 0;
  const viewW = sideways ? COURT_H : COURT_W;
  const viewH = sideways ? COURT_W : COURT_H;
  const w = Math.min(width - 24, 600);
  const h = (w * viewH) / viewW;
  const line = '#ffffff';
  const sw = 0.3;
  const fy = (y: number) => COURT_H - y; // flip so baseline is at the bottom

  return (
    <Pressable
      style={{ width: w, height: h, alignSelf: 'center', borderRadius: 8, overflow: 'hidden' }}
      onPress={(e) => {
        const { locationX, locationY } = e.nativeEvent;
        const [cx, cy] = unrotate((locationX / w) * viewW, (locationY / h) * viewH, rotation);
        const x = Math.min(Math.max(cx, 0), COURT_W);
        const y = Math.min(Math.max(COURT_H - cy, 0), COURT_H);
        onTapCourt(x, y);
      }}
    >
      <View pointerEvents="none">
        <Svg width={w} height={h} viewBox={`0 0 ${viewW} ${viewH}`}>
          <G transform={ROTATION_TRANSFORMS[rotation]}>
            <Rect x={0} y={0} width={COURT_W} height={COURT_H} fill="#ecc99e" />
            <Rect x={0.15} y={0.15} width={COURT_W - 0.3} height={COURT_H - 0.3} fill="none" stroke={line} strokeWidth={sw} />
            {/* paint */}
            <Rect x={17} y={fy(19)} width={16} height={19} fill="none" stroke={line} strokeWidth={sw} />
            {/* free throw circle */}
            <Circle cx={25} cy={fy(19)} r={6} fill="none" stroke={line} strokeWidth={sw} />
            {/* backboard + rim */}
            <Line x1={22} y1={fy(4)} x2={28} y2={fy(4)} stroke={line} strokeWidth={sw * 1.5} />
            <Circle cx={25} cy={fy(5.25)} r={0.75} fill="none" stroke="#e8590c" strokeWidth={sw} />
            {/* restricted area */}
            <Path d={`M 29 ${fy(5.25)} A 4 4 0 0 0 21 ${fy(5.25)}`} fill="none" stroke={line} strokeWidth={sw} />
            {/* three-point line: 3 ft from sideline, 23.75 ft arc from the rim */}
            <Path
              d={`M 3 ${COURT_H} L 3 ${fy(14.2)} A 23.75 23.75 0 0 1 47 ${fy(14.2)} L 47 ${COURT_H}`}
              fill="none"
              stroke={line}
              strokeWidth={sw}
            />
            {/* shot markers */}
            {shots.map((s) => {
              const cx = s.x;
              const cy = fy(s.y);
              return (
                <React.Fragment key={s.id}>
                  {isMade(s.result) ? (
                    <Circle cx={cx} cy={cy} r={1} fill="#2f9e44" stroke="#ffffff" strokeWidth={0.15} />
                  ) : (
                    <>
                      <Line x1={cx - 0.9} y1={cy - 0.9} x2={cx + 0.9} y2={cy + 0.9} stroke="#e03131" strokeWidth={0.45} strokeLinecap="round" />
                      <Line x1={cx - 0.9} y1={cy + 0.9} x2={cx + 0.9} y2={cy - 0.9} stroke="#e03131" strokeWidth={0.45} strokeLinecap="round" />
                    </>
                  )}
                  {hasFoul(s.result) && (
                    <Circle cx={cx} cy={cy} r={1.7} fill="none" stroke="#fab005" strokeWidth={0.3} />
                  )}
                </React.Fragment>
              );
            })}
          </G>
        </Svg>
      </View>
    </Pressable>
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
  addRebound: (playerId: string) => void;
  undoRebound: (playerId: string) => void;
}) {
  const count = rebounds.filter((r) => r.playerId === playerId).length;

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>Rebounds</Text>
        <Text style={styles.panelScore}>{count}</Text>
      </View>
      <View style={{ flexDirection: 'row', marginTop: 10 }}>
        <Pressable style={[styles.panelBtn, styles.btnBlue]} onPress={() => addRebound(playerId)}>
          <Text style={styles.panelBtnText}>+ Rebound</Text>
        </Pressable>
      </View>
      <Pressable
        onPress={() => undoRebound(playerId)}
        disabled={count === 0}
        style={[styles.undo, { marginTop: 10, alignSelf: 'flex-end' }, count === 0 && { opacity: 0.4 }]}
      >
        <Text style={styles.btnText}>Undo last rebound</Text>
      </Pressable>
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
  addRebound: (playerId: string) => void;
  undoRebound: (playerId: string) => void;
  rotation: Rotation;
  rotateCourt: () => void;
}) {
  const { players, shots, freeThrows, rebounds, selected, setSelected, addPlayer, addShot, undo, addFT, undoFT, addRebound, undoRebound, rotation, rotateCourt } = props;
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [pendingPlayer, setPendingPlayer] = useState<string | null>(null);
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
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        <Court shots={visible} rotation={rotation} onTapCourt={(x, y) => players.length > 0 && setPending({ x, y })} />
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
            <Text style={styles.cardTitle}>Shot result</Text>
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
  if (players.length === 0) return <Text style={styles.hint}>No players yet.</Text>;
  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
      {players.map((p) => {
        const s = shots.filter((x) => x.playerId === p.id);
        const ft = freeThrows.filter((x) => x.playerId === p.id);
        return (
          <View key={p.id} style={styles.statCard}>
            <Text style={styles.statName}>{p.name}</Text>
            <Text style={styles.statLine}>Points {totalPoints(s, ft)}</Text>
            <Text style={styles.statLine}>FG {shootingLine(s)}</Text>
            <Text style={styles.statLine}>3PT {shootingLine(s.filter(isThree))}</Text>
            <Text style={styles.statLine}>FT {ft.filter((x) => x.made).length}/{ft.length}</Text>
            <Text style={styles.statLine}>Rebounds {rebounds.filter((x) => x.playerId === p.id).length}</Text>
            <Text style={styles.statSmall}>Fouled on {s.filter((x) => hasFoul(x.result)).length} shots</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

function AdminScreen({
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
  const exportData = async () => {
    try {
      await Share.share({ message: JSON.stringify({ players, shots, freeThrows, rebounds }, null, 2) });
    } catch {
      Alert.alert('Export failed', "Couldn't open the share sheet. Please try again.");
    }
  };

  return (
    <View style={{ padding: 12 }}>
      <View style={styles.statCard}>
        <Text style={styles.statName}>Export data</Text>
        <Text style={styles.statSmall}>
          Shares all players, shots, free throws and rebounds as JSON text. Save it somewhere safe to keep a copy.
        </Text>
        <Pressable style={[styles.btn, styles.btnBlue, { marginTop: 12 }]} onPress={exportData}>
          <Text style={[styles.btnText, { color: '#fff' }]}>Export data</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------- App ----------

type Tab = 'shots' | 'stats' | 'admin';

export default function App() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [freeThrows, setFreeThrows] = useState<FreeThrow[]>([]);
  const [rebounds, setRebounds] = useState<Rebound[]>([]);
  const [rotation, setRotation] = useState<Rotation>(0);
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
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ players, shots, freeThrows, rebounds, rotation })).catch(() => {});
  }, [players, shots, freeThrows, rebounds, rotation, loaded, savingBlocked]);

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
  const addRebound = (playerId: string) => setRebounds((prev) => [...prev, { id: uid(), playerId, date: Date.now() }]);
  const undoRebound = (playerId: string) =>
    setRebounds((prev) => {
      const i = prev.map((r) => r.playerId).lastIndexOf(playerId);
      return i < 0 ? prev : prev.filter((_, idx) => idx !== i);
    });
  const rotateCourt = () => setRotation((prev) => ((prev + 90) % 360) as Rotation);

  if (!loaded) return null;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        <Text style={styles.title}>{tab === 'shots' ? 'Shots' : tab === 'stats' ? 'Stats' : 'Admin'}</Text>
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
            />
          )}
          {tab === 'stats' && <StatsScreen players={players} shots={shots} freeThrows={freeThrows} rebounds={rebounds} />}
          {tab === 'admin' && <AdminScreen players={players} shots={shots} freeThrows={freeThrows} rebounds={rebounds} />}
        </View>
        <View style={styles.tabBar}>
          {(
            [
              ['shots', 'Shots'],
              ['stats', 'Stats'],
              ['admin', 'Admin'],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <Pressable key={key} style={styles.tab} onPress={() => setTab(key)}>
              <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// ---------- Styles ----------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8f9fa' },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center', paddingVertical: 8 },
  warning: { backgroundColor: '#fff3bf', color: '#212529', textAlign: 'center', padding: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: '#e9ecef' },
  chipOn: { backgroundColor: '#1971c2' },
  chipAdd: { backgroundColor: '#dee2e6' },
  chipText: { fontSize: 15, color: '#212529' },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  hint: { textAlign: 'center', color: '#868e96', marginTop: 12, paddingHorizontal: 16 },
  legend: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginTop: 10 },
  legendText: { color: '#495057' },
  undo: { backgroundColor: '#dee2e6', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16 },
  cardTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  shooterPicker: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 12, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#ced4da', borderRadius: 8, padding: 10, fontSize: 16, marginTop: 12 },
  btn: { paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  btnText: { fontSize: 16, fontWeight: '600', color: '#212529' },
  btnGray: { backgroundColor: '#e9ecef' },
  btnBlue: { backgroundColor: '#1971c2' },
  btnGreen: { backgroundColor: '#2f9e44' },
  btnRed: { backgroundColor: '#e03131' },
  panel: { marginTop: 16, marginHorizontal: 12, padding: 14, backgroundColor: '#fff', borderRadius: 12 },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  panelTitle: { fontSize: 18, fontWeight: '700' },
  panelScore: { fontSize: 24, fontWeight: '800' },
  panelBtn: { flex: 1, height: 64, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  panelBtnText: { fontSize: 20, fontWeight: '700', color: '#fff' },
  statCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14 },
  statName: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  statLine: { fontSize: 16, marginTop: 2 },
  statSmall: { fontSize: 13, color: '#868e96', marginTop: 6 },
  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ced4da', backgroundColor: '#fff' },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabText: { fontSize: 15, color: '#868e96' },
  tabTextOn: { color: '#1971c2', fontWeight: '700' },
});
