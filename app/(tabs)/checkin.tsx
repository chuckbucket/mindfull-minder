import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { addMinderEvent, getAllMinderEvents, MinderEvent, Mood } from '../../logic/MinderEvents';

const GLOBAL_MINDER_ID = '__global__';

const MOOD_OPTIONS: Array<[Mood, string, string]> = [
  ['good', '😊', 'Good'],
  ['neutral', '😐', 'Neutral'],
  ['bad', '😟', 'Not great'],
];

export default function CheckInScreen() {
  const { colors } = useTheme();
  const [mood, setMood] = useState<Mood>('neutral');
  const [note, setNote] = useState('');
  const [recentCheckIns, setRecentCheckIns] = useState<MinderEvent[]>([]);

  const loadRecent = useCallback(async () => {
    const all = await getAllMinderEvents();
    const global = all
      .filter(e => e.minderId === GLOBAL_MINDER_ID && e.kind === 'log')
      .sort((a, b) => b.at - a.at)
      .slice(0, 5);
    setRecentCheckIns(global);
  }, []);

  useFocusEffect(useCallback(() => {
    void loadRecent();
  }, [loadRecent]));

  const handleSave = async () => {
    await addMinderEvent({
      minderId: GLOBAL_MINDER_ID,
      kind: 'log',
      at: Date.now(),
      mood,
      text: note.trim() || undefined,
    });
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setNote('');
    setMood('neutral');
    void loadRecent();
  };

  const formatDate = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.heading, { color: colors.text }]}>How are you right now?</Text>
        <Text style={[styles.subheading, { color: colors.text }]}>
          A moment to check in — no minder required.
        </Text>

        <View style={styles.moodRow}>
          {MOOD_OPTIONS.map(([m, emoji, label]) => (
            <TouchableOpacity
              key={m}
              style={[
                styles.moodButton,
                {
                  backgroundColor: mood === m ? colors.primary : colors.card,
                  borderColor: mood === m ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setMood(m)}
              accessibilityLabel={`Set mood to ${label}`}
              accessibilityRole="button"
              accessibilityState={{ selected: mood === m }}
            >
              <Text style={styles.moodEmoji}>{emoji}</Text>
              <Text style={{ color: mood === m ? 'white' : colors.text, fontWeight: '600', fontSize: 13 }}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TextInput
          style={[styles.input, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
          placeholder="Anything you want to note? (optional)"
          placeholderTextColor={colors.text + '88'}
          value={note}
          onChangeText={setNote}
          multiline
          accessibilityLabel="Optional check-in note"
        />

        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: colors.primary }]}
          onPress={handleSave}
          accessibilityLabel="Save check-in"
          accessibilityRole="button"
        >
          <Text style={styles.saveButtonText}>Save Check-in</Text>
        </TouchableOpacity>

        {recentCheckIns.length > 0 && (
          <>
            <Text style={[styles.recentHeading, { color: colors.text }]}>Recent Check-ins</Text>
            {recentCheckIns.map(e => (
              <View key={e.id} style={[styles.recentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.recentDate, { color: colors.text }]}>{formatDate(e.at)}</Text>
                {e.mood && (
                  <Text style={styles.recentMood}>
                    {e.mood === 'good' ? '😊 Good' : e.mood === 'neutral' ? '😐 Neutral' : '😟 Not great'}
                  </Text>
                )}
                {!!e.text && <Text style={[styles.recentNote, { color: colors.text }]}>{e.text}</Text>}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, gap: 14 },
  heading: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  subheading: { fontSize: 14, textAlign: 'center', opacity: 0.6, marginTop: -6 },
  moodRow: { flexDirection: 'row', gap: 10 },
  moodButton: {
    flex: 1,
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 6,
  },
  moodEmoji: { fontSize: 28 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  saveButton: {
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveButtonText: { color: 'white', fontWeight: '700', fontSize: 16 },
  recentHeading: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 8,
    opacity: 0.85,
  },
  recentCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  recentDate: { fontSize: 12, opacity: 0.5 },
  recentMood: { fontSize: 14 },
  recentNote: { fontSize: 14, lineHeight: 20, opacity: 0.85 },
});
