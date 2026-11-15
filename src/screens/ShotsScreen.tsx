import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import {
  RESULTS,
  isMade,
  type Player,
  type Shot,
  type FreeThrow,
  type ReboundKind,
  type Rebound,
  REBOUND_KINDS,
} from '../model';
import { useTheme } from '../theme';
import { type Rotation } from '../court/geometry';
import { type CourtColors } from '../court/colors';
import { Court } from '../court/Court';
import { PlayerPicker } from '../components/PlayerPicker';

// Left to right in the Add stat popup.
const POPUP_REBOUNDS: { key: ReboundKind; label: string }[] = [
  { key: 'defensive', label: 'Defensive Rebound' },
  { key: 'offensive', label: 'Offensive Rebound' },
];

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

export function ShotsScreen(props: {
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
