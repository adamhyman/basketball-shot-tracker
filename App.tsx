import { useEffect, useState } from 'react';
import { View, Text, Pressable, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import {
  type ShotResult,
  type Player,
  type Shot,
  type FreeThrow,
  type ReboundKind,
  type Rebound,
  type PracticeLocation,
  type PracticeSession,
} from './src/model';
import { type ThemeMode, LIGHT_THEME, DARK_THEME, ThemeContext } from './src/theme';
import { type Rotation } from './src/court/geometry';
import { type CourtColors, DEFAULT_COLORS } from './src/court/colors';
import { type Tab, TabIcon } from './src/components/TabIcon';
import { ShotsScreen } from './src/screens/ShotsScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { HeatMapScreen } from './src/screens/HeatMapScreen';
import { ShotPracticeScreen } from './src/screens/ShotPracticeScreen';
import { PracticeChartsScreen } from './src/screens/PracticeChartsScreen';
import { NbaLiveScreen } from './src/screens/NbaLiveScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const STORAGE_KEY = 'shot-tracker-v1';

const CORRUPT_BACKUP_KEY = 'shot-tracker-v1-corrupt-backup';

// Older saves split misses by who got the rebound.
const migrateShot = (s: Omit<Shot, 'result'> & { result: string }): Shot => ({
  ...s,
  result: s.result === 'missedRebound' || s.result === 'missedNoRebound' ? 'missed' : (s.result as ShotResult),
});

const TABS: [Tab, string][] = [
  ['shots', 'Shot Chart'],
  ['stats', 'Stats'],
  ['heat', 'Heat Map'],
  ['practice', 'Shot Practice'],
  ['practiceCharts', 'Practice Charts'],
  ['nbaLive', 'NBA Live'],
  ['settings', 'Settings'],
];

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
              {tab === 'nbaLive' && <NbaLiveScreen />}
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
