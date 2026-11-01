import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Modal,
  TextInput,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import Svg, { Rect, Circle, Line, Path } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

// ---------- Types ----------

type ShotResult = 'madeFoul' | 'made' | 'missedFoul' | 'missedRebound' | 'missedNoRebound';

const RESULTS: { key: ShotResult; label: string }[] = [
  { key: 'madeFoul', label: 'Made with foul' },
  { key: 'made', label: 'Made, no foul' },
  { key: 'missedFoul', label: 'Missed with foul' },
  { key: 'missedRebound', label: 'Missed, teammate got rebound' },
  { key: 'missedNoRebound', label: 'Missed, no team rebound' },
];

const isMade = (r: ShotResult) => r === 'made' || r === 'madeFoul';
const hasFoul = (r: ShotResult) => r === 'madeFoul' || r === 'missedFoul';
// A missed shot with a foul isn't charged as a field goal attempt.
const isFieldGoalAttempt = (r: ShotResult) => r !== 'missedFoul';

type Player = { id: string; name: string };
// x: 0..50 ft (left to right), y: 0..47 ft (baseline up)
type Shot = { id: string; playerId: string; x: number; y: number; result: ShotResult; date: number };
type FreeThrow = { id: string; playerId: string; made: boolean; date: number };

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const STORAGE_KEY = 'shot-tracker-v1';
const CORRUPT_BACKUP_KEY = 'shot-tracker-v1-corrupt-backup';

// ---------- Court ----------

const COURT_W = 50;
const COURT_H = 47;

function Court({
  shots,
  onTapCourt,
}: {
  shots: Shot[];
  onTapCourt: (x: number, y: number) => void;
}) {
  const { width } = useWindowDimensions();
  const w = Math.min(width - 24, 600);
  const h = (w * COURT_H) / COURT_W;
  const line = '#ffffff';
  const sw = 0.3;
  const fy = (y: number) => COURT_H - y; // flip so baseline is at the bottom

  return (
    <Pressable
      style={{ width: w, height: h, alignSelf: 'center', borderRadius: 8, overflow: 'hidden' }}
      onPress={(e) => {
        const { locationX, locationY } = e.nativeEvent;
        const x = Math.min(Math.max((locationX / w) * COURT_W, 0), COURT_W);
        const y = Math.min(Math.max(COURT_H - (locationY / h) * COURT_H, 0), COURT_H);
        onTapCourt(x, y);
      }}
    >
      <View pointerEvents="none">
        <Svg width={w} height={h} viewBox={`0 0 ${COURT_W} ${COURT_H}`}>
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
  allowAll,
}: {
  players: Player[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (name: string) => void;
  allowAll: boolean;
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
        {allowAll && (
          <Pressable onPress={() => onSelect(null)} style={[styles.chip, selected === null && styles.chipOn]}>
            <Text style={[styles.chipText, selected === null && styles.chipTextOn]}>All</Text>
          </Pressable>
        )}
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
              <Pressable style={[styles.btn, styles.btnGray]} onPress={() => { setName(''); setAdding(false); }}>
                <Text style={styles.btnText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.btnBlue]} onPress={submit}>
                <Text style={[styles.btnText, { color: '#fff' }]}>Add</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---------- Screens ----------

function ShotsScreen(props: {
  players: Player[];
  shots: Shot[];
  selected: string | null;
  setSelected: (id: string | null) => void;
  addPlayer: (name: string) => void;
  addShot: (s: Omit<Shot, 'id' | 'date'>) => void;
  undo: (playerId: string | null) => void;
}) {
  const { players, shots, selected, setSelected, addPlayer, addShot, undo } = props;
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const visible = useMemo(() => shots.filter((s) => selected === null || s.playerId === selected), [shots, selected]);

  return (
    <View style={{ flex: 1 }}>
      <PlayerPicker players={players} selected={selected} onSelect={setSelected} onAdd={addPlayer} allowAll />
      <Court shots={visible} onTapCourt={(x, y) => selected && setPending({ x, y })} />
      <Text style={styles.hint}>
        {selected
          ? 'Tap the court where the shot was taken.'
          : players.length === 0
          ? 'Add a player to get started.'
          : 'Select a player, then tap the court.'}
      </Text>
      <View style={styles.legend}>
        <Text style={styles.legendText}>● made   ✕ missed   ○ foul</Text>
        <Pressable onPress={() => undo(selected)} disabled={visible.length === 0} style={[styles.undo, visible.length === 0 && { opacity: 0.4 }]}>
          <Text style={styles.btnText}>Undo last shot</Text>
        </Pressable>
      </View>

      <Modal transparent animationType="fade" visible={pending !== null} onRequestClose={() => setPending(null)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Shot result</Text>
            {RESULTS.map((r) => (
              <Pressable
                key={r.key}
                style={[styles.btn, isMade(r.key) ? styles.btnGreen : styles.btnRed, { marginTop: 8 }]}
                onPress={() => {
                  if (pending && selected) addShot({ playerId: selected, x: pending.x, y: pending.y, result: r.key });
                  setPending(null);
                }}
              >
                <Text style={[styles.btnText, { color: '#fff' }]}>{r.label}</Text>
              </Pressable>
            ))}
            <Pressable style={[styles.btn, styles.btnGray, { marginTop: 12 }]} onPress={() => setPending(null)}>
              <Text style={styles.btnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function FreeThrowScreen(props: {
  players: Player[];
  freeThrows: FreeThrow[];
  selected: string | null;
  setSelected: (id: string | null) => void;
  addPlayer: (name: string) => void;
  addFT: (playerId: string, made: boolean) => void;
  undoFT: (playerId: string) => void;
}) {
  const { players, freeThrows, selected, setSelected, addPlayer, addFT, undoFT } = props;
  const mine = freeThrows.filter((f) => f.playerId === selected);

  return (
    <View style={{ flex: 1 }}>
      <PlayerPicker players={players} selected={selected} onSelect={setSelected} onAdd={addPlayer} allowAll={false} />
      {selected ? (
        <View style={{ padding: 16, alignItems: 'center' }}>
          <Text style={styles.bigNumber}>
            {mine.filter((f) => f.made).length} / {mine.length}
          </Text>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 24, width: '100%' }}>
            <Pressable style={[styles.ftBtn, styles.btnGreen]} onPress={() => addFT(selected, true)}>
              <Text style={styles.ftBtnText}>Made</Text>
            </Pressable>
            <Pressable style={[styles.ftBtn, styles.btnRed]} onPress={() => addFT(selected, false)}>
              <Text style={styles.ftBtnText}>Missed</Text>
            </Pressable>
          </View>
          <Pressable
            onPress={() => undoFT(selected)}
            disabled={mine.length === 0}
            style={[styles.undo, { marginTop: 20 }, mine.length === 0 && { opacity: 0.4 }]}
          >
            <Text style={styles.btnText}>Undo last free throw</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.hint}>Select a player to record free throws.</Text>
      )}
    </View>
  );
}

function StatsScreen({ players, shots, freeThrows }: { players: Player[]; shots: Shot[]; freeThrows: FreeThrow[] }) {
  if (players.length === 0) return <Text style={styles.hint}>No players yet.</Text>;
  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
      {players.map((p) => {
        const s = shots.filter((x) => x.playerId === p.id);
        const ft = freeThrows.filter((x) => x.playerId === p.id);
        const made = s.filter((x) => isMade(x.result)).length;
        const attempts = s.filter((x) => isFieldGoalAttempt(x.result)).length;
        const pct = attempts ? ` (${Math.round((100 * made) / attempts)}%)` : '';
        return (
          <View key={p.id} style={styles.statCard}>
            <Text style={styles.statName}>{p.name}</Text>
            <Text style={styles.statLine}>FG {made}/{attempts}{pct}</Text>
            <Text style={styles.statLine}>FT {ft.filter((x) => x.made).length}/{ft.length}</Text>
            <Text style={styles.statSmall}>
              Fouled on {s.filter((x) => hasFoul(x.result)).length} shots · Team rebounds{' '}
              {s.filter((x) => x.result === 'missedRebound').length}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

// ---------- App ----------

type Tab = 'shots' | 'ft' | 'stats';

export default function App() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [freeThrows, setFreeThrows] = useState<FreeThrow[]>([]);
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
          setShots(d.shots ?? []);
          setFreeThrows(d.freeThrows ?? []);
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
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ players, shots, freeThrows })).catch(() => {});
  }, [players, shots, freeThrows, loaded, savingBlocked]);

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

  if (!loaded) return null;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        <Text style={styles.title}>{tab === 'shots' ? 'Shots' : tab === 'ft' ? 'Free Throws' : 'Stats'}</Text>
        {savingBlocked && (
          <Text style={styles.warning}>Couldn't access saved data. Changes won't be saved. Restart the app to try again.</Text>
        )}
        <View style={{ flex: 1 }}>
          {tab === 'shots' && (
            <ShotsScreen
              players={players}
              shots={shots}
              selected={selected}
              setSelected={setSelected}
              addPlayer={addPlayer}
              addShot={addShot}
              undo={undoShot}
            />
          )}
          {tab === 'ft' && (
            <FreeThrowScreen
              players={players}
              freeThrows={freeThrows}
              selected={selected}
              setSelected={setSelected}
              addPlayer={addPlayer}
              addFT={addFT}
              undoFT={undoFT}
            />
          )}
          {tab === 'stats' && <StatsScreen players={players} shots={shots} freeThrows={freeThrows} />}
        </View>
        <View style={styles.tabBar}>
          {(
            [
              ['shots', 'Shots'],
              ['ft', 'Free Throws'],
              ['stats', 'Stats'],
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
  input: { borderWidth: 1, borderColor: '#ced4da', borderRadius: 8, padding: 10, fontSize: 16, marginTop: 12 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  btnText: { fontSize: 16, fontWeight: '600', color: '#212529' },
  btnGray: { backgroundColor: '#e9ecef' },
  btnBlue: { backgroundColor: '#1971c2' },
  btnGreen: { backgroundColor: '#2f9e44' },
  btnRed: { backgroundColor: '#e03131' },
  bigNumber: { fontSize: 64, fontWeight: '800', marginTop: 16 },
  ftBtn: { flex: 1, height: 90, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  ftBtnText: { fontSize: 24, fontWeight: '700', color: '#fff' },
  statCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14 },
  statName: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  statLine: { fontSize: 16, marginTop: 2 },
  statSmall: { fontSize: 13, color: '#868e96', marginTop: 6 },
  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ced4da', backgroundColor: '#fff' },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabText: { fontSize: 15, color: '#868e96' },
  tabTextOn: { color: '#1971c2', fontWeight: '700' },
});
