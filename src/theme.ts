import { createContext, useContext } from 'react';
import { StyleSheet } from 'react-native';

export type ThemeMode = 'light' | 'dark' | 'phone';

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

export const LIGHT_THEME = { t: LIGHT_COLORS, styles: makeStyles(LIGHT_COLORS) };

export const DARK_THEME = { t: DARK_COLORS, styles: makeStyles(DARK_COLORS) };

export const ThemeContext = createContext(LIGHT_THEME);

export function useTheme() {
  return useContext(ThemeContext);
}
