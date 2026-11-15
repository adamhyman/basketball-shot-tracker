import { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal, TextInput, Alert, Keyboard } from 'react-native';

import { type PracticeLocation, type PracticeSession } from '../model';
import { useTheme } from '../theme';
import { formatDate, startOfDay } from '../dates';
import { PRACTICE_SHOTS, practiceLine } from '../practice';
import { type Rotation } from '../court/geometry';
import { type CourtColors } from '../court/colors';
import { PracticeCourt } from '../court/PracticeCourt';
import { NamePrompt } from '../components/NamePrompt';
import { LocationPicker } from '../components/LocationPicker';
import { CalendarPicker } from '../components/CalendarPicker';

export function ShotPracticeScreen({
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
