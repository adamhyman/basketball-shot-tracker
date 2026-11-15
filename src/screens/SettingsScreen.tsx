import { useState } from 'react';
import { View, Text, Pressable, ScrollView, Share, Alert } from 'react-native';
import Svg, { Rect, Circle, Line } from 'react-native-svg';

import {
  type Player,
  type Shot,
  type FreeThrow,
  type Rebound,
  type PracticeLocation,
  type PracticeSession,
} from '../model';
import { type ThemeMode, useTheme } from '../theme';
import { type CourtTexture, type CourtColors, DEFAULT_COLORS } from '../court/colors';
import { CourtTextureLayer, ShotMarker } from '../court/Court';

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

export function SettingsScreen({
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
