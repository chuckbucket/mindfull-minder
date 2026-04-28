import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../context/ThemeContext';
import * as Notifications from 'expo-notifications';
import { addMinderEvent, getEventsForMinder, MinderEvent, Mood, upsertMissedEvents } from '../../logic/MinderEvents';

const MINDERS_STORAGE_KEY = '@minders';
const COMPLETIONS_STORAGE_KEY = '@completions';

type Minder = {
  id: string;
  name: string;
  color: string;
  reminderFrequency: string;
};

const formatWhen = (ms: number) => {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
};

const kindLabel = (kind: MinderEvent['kind']) => {
  if (kind === 'log' || kind === 'note') return 'Log';
  if (kind === 'completed') return 'Completed';
  if (kind === 'triggered') return 'Triggered';
  return 'Missed';
};

export default function MinderHistoryScreen() {
  const { colors } = useTheme();
  const { minderId } = useLocalSearchParams<{ minderId: string }>();
  const router = useRouter();

  const [minder, setMinder] = useState<Minder | null>(null);
  const [events, setEvents] = useState<MinderEvent[]>([]);
  const [draft, setDraft] = useState('');
  const [mood, setMood] = useState<Mood>('neutral');
  const [attachTriggerAt, setAttachTriggerAt] = useState<number | undefined>(undefined);
  const [triggeredTriggerAts, setTriggeredTriggerAts] = useState<number[]>([]);

  const load = useCallback(async () => {
    if (!minderId) return;
    const stored = await AsyncStorage.getItem(MINDERS_STORAGE_KEY);
    const list = stored ? (JSON.parse(stored) as Minder[]) : [];
    setMinder(list.find(m => m.id === minderId) || null);

    const storedCompletions = await AsyncStorage.getItem(COMPLETIONS_STORAGE_KEY);
    const loadedCompletions = storedCompletions ? (JSON.parse(storedCompletions) as { [key: string]: number[] }) : {};
    const minderCompletions = loadedCompletions[minderId] || [];

    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const now = Date.now();
    const missed: number[] = [];
    for (const notif of scheduled as any[]) {
      if (notif?.content?.data?.minderId !== minderId) continue;
      const triggerDateValue = notif?.trigger?.timestamp;
      if (!triggerDateValue) continue;
      const triggerAt = new Date(triggerDateValue).getTime();
      if (Number.isNaN(triggerAt) || triggerAt > now) continue;
      const isHandled = minderCompletions.some(compTime => compTime > triggerAt);
      if (!isHandled) missed.push(triggerAt);
    }

    await upsertMissedEvents(minderId, missed);
    const loaded = await getEventsForMinder(minderId);
    setEvents(loaded);
    setTriggeredTriggerAts(loaded.filter(e => e.kind === 'triggered' && typeof e.triggerAt === 'number').map(e => e.triggerAt as number));
    const mostRecentTriggerAt = loaded.find(e => typeof e.triggerAt === 'number')?.triggerAt;
    setAttachTriggerAt(mostRecentTriggerAt);
  }, [minderId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const addNote = async () => {
    if (!minderId) return;
    const text = draft.trim();
    if (!text) return;
    let triggerAtForLog = attachTriggerAt;
    if (minder && minder.reminderFrequency !== 'Continuous' && typeof triggerAtForLog !== 'number') {
      const manualAt = Date.now();
      triggerAtForLog = manualAt;
      void addMinderEvent({ id: `triggered:${minderId}:${manualAt}`, minderId, kind: 'triggered', at: manualAt, triggerAt: manualAt });
    }

    const logAt = Date.now();
    if (minder && minder.reminderFrequency !== 'Continuous') {
      const candidates: number[] = [];
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      candidates.push(
        ...(scheduled as any[])
          .filter(n => n?.content?.data?.minderId === minderId)
          .map(n => n?.trigger?.timestamp)
          .filter(Boolean)
          .map((d: any) => new Date(d).getTime())
          .filter((t: any) => typeof t === 'number' && !Number.isNaN(t)),
      );
      candidates.push(...triggeredTriggerAts);
      let best: number | undefined;
      let bestDiff = Infinity;
      for (const t of candidates) {
        const diff = Math.abs(t - logAt);
        if (diff < bestDiff) {
          best = t;
          bestDiff = diff;
        }
      }
      if (typeof best === 'number' && bestDiff <= 15 * 60 * 1000) {
        triggerAtForLog = best;
        void addMinderEvent({ id: `completed:${minderId}:${best}`, minderId, kind: 'completed', at: logAt, triggerAt: best });
      }
    }

    await addMinderEvent({ minderId, kind: 'log', at: logAt, text, mood, triggerAt: triggerAtForLog });
    setDraft('');
    setMood('neutral');
    await load();
  };

  const missedCount = events.filter(e => e.kind === 'missed').length;
  const completedCount = events.filter(e => e.kind === 'completed').length;

  if (!minderId) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backButton, { borderColor: colors.border }]}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {minder?.name || 'Minder'}
          </Text>
          <Text style={{ color: colors.text, opacity: 0.8 }}>
            {completedCount} completed • {missedCount} missed
          </Text>
        </View>
        <View style={[styles.colorDot, { backgroundColor: minder?.color || colors.primary }]} />
      </View>

      <View style={[styles.noteComposer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 8 }}>Add log</Text>
        {typeof attachTriggerAt === 'number' && (
          <Text style={{ color: colors.text, opacity: 0.8, marginBottom: 8 }}>For reminder: {formatWhen(attachTriggerAt)}</Text>
        )}
        <View style={styles.moodRow}>
          {(['good', 'neutral', 'bad'] as const).map(m => (
            <TouchableOpacity
              key={m}
              onPress={() => setMood(m)}
              style={[
                styles.moodButton,
                { backgroundColor: mood === m ? colors.primary : colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={{ color: mood === m ? 'white' : colors.text, fontWeight: '800' }}>
                {m === 'good' ? 'Good' : m === 'neutral' ? 'Neutral' : 'Bad'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Write a quick reflection..."
          placeholderTextColor={colors.text}
          multiline
          style={[styles.noteInput, { color: colors.text, borderColor: colors.border }]}
        />
        <View style={styles.noteActions}>
          <TouchableOpacity onPress={addNote} style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
            <Text style={{ color: 'white', fontWeight: '800' }}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={events}
        keyExtractor={e => e.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          <View style={{ padding: 16 }}>
            <Text style={{ color: colors.text, opacity: 0.8 }}>No history yet.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.eventRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.eventHeader}>
              <Text style={{ color: colors.text, fontWeight: '800' }}>{kindLabel(item.kind)}</Text>
              <Text style={{ color: colors.text, opacity: 0.75 }}>{formatWhen(item.at)}</Text>
            </View>
            {(item.kind === 'log' || item.kind === 'note') && (
              <>
                {item.mood && (
                  <Text style={{ color: colors.text, marginTop: 8, opacity: 0.85 }}>
                    Mood: {item.mood === 'good' ? 'Good' : item.mood === 'neutral' ? 'Neutral' : 'Bad'}
                  </Text>
                )}
                {!!item.text && <Text style={{ color: colors.text, marginTop: 8 }}>{item.text}</Text>}
                {item.triggerAt && (
                  <Text style={{ color: colors.text, marginTop: 8, opacity: 0.85 }}>Reminder: {formatWhen(item.triggerAt)}</Text>
                )}
              </>
            )}
            {item.kind !== 'log' && item.kind !== 'note' && item.triggerAt && (
              <Text style={{ color: colors.text, marginTop: 8, opacity: 0.85 }}>Trigger: {formatWhen(item.triggerAt)}</Text>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
  },
  colorDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  noteComposer: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  noteInput: {
    minHeight: 70,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 16,
  },
  moodRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  moodButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  noteActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
  },
  primaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  eventRow: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
});
