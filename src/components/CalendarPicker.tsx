import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';

import { useTheme } from '../theme';
import { formatDate, startOfDay } from '../dates';

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// A month grid of days; days after today can't be picked.
export function CalendarPicker({ value, onChange }: { value: number; onChange: (day: number) => void }) {
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
