import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as StoreReview from 'expo-store-review';
import { useTheme } from '../../context/ThemeContext';
import * as Notifications from 'expo-notifications';
import { addMinderEvent, getEventsForMinder, MinderEvent, Mood, upsertMissedEvents } from '../../logic/MinderEvents';

const MINDERS_STORAGE_KEY = '@minders';
const COMPLETIONS_STORAGE_KEY = '@completions';
const REVIEW_COUNT_KEY = '@totalCompletionCount';

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

const toDateKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const computeStats = (events: MinderEvent[]) => {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = events.filter(e => e.at >= sevenDaysAgo);
  const recentCompleted = recent.filter(e => e.kind === 'completed').length;
  const recentMissed = recent.filter(e => e.kind === 'missed').length;
  const total = recentCompleted + recentMissed;
  const completionRate = total > 0 ? Math.round((recentCompleted / total) * 100) : null;
  const totalLogs = events.filter(e => e.kind === 'log' || e.kind === 'note').length;

  const completionDayKeys = new Set(
    events.filter(e => e.kind === 'completed').map(e => toDateKey(e.at)),
  );
  const todayKey = toDateKey(Date.now());
  let streak = 0;
  const startDay = completionDayKeys.has(todayKey) ? 0 : 1;
  for (let i = startDay; i < 365; i++) {
    const key = toDateKey(Date.now() - i * 86400000);
    if (completionDayKeys.has(key)) {
      streak++;
    } else {
      break;
    }
  }

  return { completionRate, totalLogs, streak };
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

  const maybeRequestReview = async () => {
    try {
      const raw = await AsyncStorage.getItem(REVIEW_COUNT_KEY);
      const count = (Number(raw) || 0) + 1;
      await AsyncStorage.setItem(REVIEW_COUNT_KEY, String(count));
      if (count === 7) {
        const available = await StoreReview.isAvailableAsync();
        if (available) await StoreReview.requestReview();
      }
    } catch {
      // non-critical
    }
  };

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
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await maybeRequestReview();
    setDraft('');
    setMood('neutral');
    await load();
  };

  const handleRetroComplete = async (event: MinderEvent) => {
    const triggerAt = event.triggerAt ?? event.at;
    await addMinderEvent({
      id: `completed:${event.minderId}:${triggerAt}`,
      minderId: event.minderId,
      kind: 'completed',
      at: Date.now(),
      triggerAt,
    });
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await maybeRequestReview();
    await load();
  };

  const stats = computeStats(events);
  const missedCount = events.filter(e => e.kind === 'missed').length;
  const completedCount = events.filter(e => e.kind === 'completed').length;

  if (!minderId) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.backButton, { borderColor: colors.border }]}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
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

      {/* Stats card */}
      <View style={[styles.statsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.primary }]}>
            {stats.completionRate !== null ? `${stats.completionRate}%` : '—'}
          </Text>
          <Text style={[styles.statLabel, { color: colors.text }]}>7-day rate</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.primary }]}>{stats.streak}</Text>
          <Text style={[styles.statLabel, { color: colors.text }]}>day streak</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.primary }]}>{stats.totalLogs}</Text>
          <Text style={[styles.statLabel, { color: colors.text }]}>total logs</Text>
        </View>
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
              accessibilityLabel={`Set mood to ${m}`}
              accessibilityRole="button"
              accessibilityState={{ selected: mood === m }}
            >
              <Text style={{ color: mood === m ? 'white' : colors.text, fontWeight: '800' }}>
                {m === 'good' ? '😊 Good' : m === 'neutral' ? '😐 Neutral' : '😟 Not great'}
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
          accessibilityLabel="Reflection text"
        />
        <View style={styles.noteActions}>
          <TouchableOpacity
            onPress={addNote}
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            accessibilityLabel="Save log entry"
            accessibilityRole="button"
          >
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
        renderItem={({ item }) => {
          const isMissed = item.kind === 'missed';
          return (
            <View style={[styles.eventRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.eventHeader}>
                <Text style={{ color: colors.text, fontWeight: '800' }}>{kindLabel(item.kind)}</Text>
                <Text style={{ color: colors.text, opacity: 0.75 }}>{formatWhen(item.at)}</Text>
              </View>
              {(item.kind === 'log' || item.kind === 'note') && (
                <>
                  {item.mood && (
                    <Text style={{ color: colors.text, marginTop: 8, opacity: 0.85 }}>
                      Mood: {item.mood === 'good' ? '😊 Good' : item.mood === 'neutral' ? '😐 Neutral' : '😟 Not great'}
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
              {isMissed && (
                <View style={styles.missedFooter}>
                  <Text style={[styles.gentleText, { color: colors.text }]}>
                    That's okay — every moment is a fresh start. 🌱
                  </Text>
                  <TouchableOpacity
                    style={[styles.retroButton, { backgroundColor: `${colors.primary}22`, borderColor: colors.primary }]}
                    onPress={() => handleRetroComplete(item)}
                    accessibilityLabel="Mark this reminder as done retroactively"
                    accessibilityRole="button"
                  >
                    <Text style={[styles.retroButtonText, { color: colors.primary }]}>
                      I actually did it ✓
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        }}
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
  statsCard: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 11,
    opacity: 0.65,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statDivider: {
    width: 1,
    height: 36,
    marginHorizontal: 8,
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
  missedFooter: {
    marginTop: 10,
    gap: 8,
  },
  gentleText: {
    fontSize: 12,
    opacity: 0.65,
    fontStyle: 'italic',
  },
  retroButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  retroButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
