import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScrollView,
  SectionList,
  SectionListData,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { addMinderEvent, getAllMinderEvents, MinderEvent } from '../../logic/MinderEvents';

const MINDERS_STORAGE_KEY = '@minders';

type Minder = { id: string; name: string; color: string; reminderFrequency: string };

type MinderStats = {
  minder: Minder;
  completionRate: number | null;
  streak: number;
  totalCompleted: number;
};

const toDateKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function computeMinderStats(minder: Minder, events: MinderEvent[]): MinderStats {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = events.filter(e => e.at >= sevenDaysAgo);
  const recentCompleted = recent.filter(e => e.kind === 'completed').length;
  const recentMissed = recent.filter(e => e.kind === 'missed').length;
  const total = recentCompleted + recentMissed;
  const completionRate = total > 0 ? Math.round((recentCompleted / total) * 100) : null;
  const totalCompleted = events.filter(e => e.kind === 'completed').length;

  const completionDayKeys = new Set(
    events.filter(e => e.kind === 'completed').map(e => toDateKey(e.at)),
  );
  const todayKey = toDateKey(Date.now());
  let streak = 0;
  const startDay = completionDayKeys.has(todayKey) ? 0 : 1;
  for (let i = startDay; i < 365; i++) {
    if (completionDayKeys.has(toDateKey(Date.now() - i * 86400000))) streak++;
    else break;
  }

  return { minder, completionRate, streak, totalCompleted };
}

type ScheduledItem = {
  type: 'scheduled';
  time: number;
  minderId: string;
  minderName: string;
  minderColor: string;
  id: string;
};

type EventItem = {
  type: 'event';
  event: MinderEvent;
  minderName: string;
  minderColor: string;
};

type NowItem = { type: 'now'; time: number };

type TimelineItem = ScheduledItem | EventItem | NowItem;
type TimelineSection = { title: string; dateKey: string; data: TimelineItem[] };

const toLocalDateKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatSectionTitle = (dateKey: string): string => {
  const now = Date.now();
  if (dateKey === toLocalDateKey(now)) return 'Today';
  if (dateKey === toLocalDateKey(now - 86400000)) return 'Yesterday';
  if (dateKey === toLocalDateKey(now + 86400000)) return 'Tomorrow';
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const formatTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const getItemTime = (item: TimelineItem): number => {
  if (item.type === 'now') return item.time;
  if (item.type === 'scheduled') return item.time;
  return item.event.triggerAt ?? item.event.at;
};

const EVENT_LABELS: Partial<Record<MinderEvent['kind'], string>> = {
  log: 'Log',
  note: 'Log',
  completed: 'Completed',
  missed: 'Missed',
};

type IconSpec = { name: React.ComponentProps<typeof Ionicons>['name']; color: string };

const kindIconSpec = (kind: MinderEvent['kind']): IconSpec => {
  if (kind === 'completed') return { name: 'checkmark-circle', color: '#4CAF50' };
  if (kind === 'missed') return { name: 'close-circle', color: '#F44336' };
  if (kind === 'log' || kind === 'note') return { name: 'create', color: '#2196F3' };
  return { name: 'ellipse-outline', color: '#9E9E9E' };
};

export default function HistoryScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [sections, setSections] = useState<TimelineSection[]>([]);
  const [minderStats, setMinderStats] = useState<MinderStats[]>([]);
  const listRef = useRef<SectionList<TimelineItem, TimelineSection>>(null);
  const scrollTarget = useRef<{ sectionIndex: number; itemIndex: number } | null>(null);

  const buildSections = useCallback(async () => {
    const now = Date.now();
    const todayStr = toLocalDateKey(now);

    const stored = await AsyncStorage.getItem(MINDERS_STORAGE_KEY);
    const minders: Minder[] = stored ? JSON.parse(stored) : [];
    const minderMap = new Map(minders.map(m => [m.id, m]));

    const dayMap = new Map<string, TimelineItem[]>();
    const cutoff45 = now + 45 * 24 * 60 * 60 * 1000;

    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    type HolidayRaw = { item: ScheduledItem; daysRemaining: number; time: number };
    const holidayGroups = new Map<string, HolidayRaw[]>();

    for (const notif of scheduled) {
      const data = notif.content.data as any;
      const minderId = data?.minderId as string | undefined;
      const isHoliday = data?.notificationType === 'holiday';
      if (!minderId && !isHoliday) continue;
      const t = notif.trigger as any;
      const raw = t?.value ?? t?.timestamp ?? t?.date;
      if (!raw) continue;
      const time = typeof raw === 'number' ? raw : new Date(raw).getTime();
      if (isNaN(time) || time > cutoff45) continue;

      if (isHoliday) {
        const holidayId = data.holidayId ?? 'unknown';
        const item: ScheduledItem = {
          type: 'scheduled',
          time,
          minderId: `holiday:${holidayId}`,
          minderName: notif.content.title ?? 'Holiday Reminder',
          minderColor: '#E91E63',
          id: notif.identifier,
        };
        const group = holidayGroups.get(holidayId) ?? [];
        group.push({ item, daysRemaining: (data.daysRemaining as number) ?? -1, time });
        holidayGroups.set(holidayId, group);
      } else {
        const minder = minderMap.get(minderId!);
        const dateKey = toLocalDateKey(time);
        const bucket = dayMap.get(dateKey) ?? [];
        bucket.push({
          type: 'scheduled',
          time,
          minderId: minderId!,
          minderName: minder?.name ?? 'Unknown',
          minderColor: minder?.color ?? '#888',
          id: notif.identifier,
        });
        dayMap.set(dateKey, bucket);
      }
    }

    // Per holiday: show only the event-day notification (daysRemaining===0) + the nearest upcoming reminder
    for (const [, raws] of holidayGroups) {
      const eventDay = raws.find(r => r.daysRemaining === 0);
      const upcoming = raws
        .filter(r => r.daysRemaining > 0 && r.time > now)
        .sort((a, b) => a.time - b.time)[0];
      for (const raw of [eventDay, upcoming]) {
        if (!raw) continue;
        const dateKey = toLocalDateKey(raw.time);
        const bucket = dayMap.get(dateKey) ?? [];
        bucket.push(raw.item);
        dayMap.set(dateKey, bucket);
      }
    }

    const allEvents = await getAllMinderEvents();

    // Compute per-minder stats for the dashboard
    const statsByMinder = new Map<string, MinderEvent[]>();
    for (const event of allEvents) {
      if (event.minderId === '__global__') continue;
      const list = statsByMinder.get(event.minderId) ?? [];
      list.push(event);
      statsByMinder.set(event.minderId, list);
    }
    const stats: MinderStats[] = minders.map(m =>
      computeMinderStats(m, statsByMinder.get(m.id) ?? []),
    );
    setMinderStats(stats);

    for (const event of allEvents) {
      if (event.kind === 'triggered') continue;
      const time = event.triggerAt ?? event.at;
      const dateKey = toLocalDateKey(time);
      const isGlobal = event.minderId === '__global__';
      const minder = isGlobal ? undefined : minderMap.get(event.minderId);
      const bucket = dayMap.get(dateKey) ?? [];
      bucket.push({
        type: 'event',
        event,
        minderName: isGlobal ? 'Quick Check-in' : (minder?.name ?? 'Unknown'),
        minderColor: isGlobal ? '#9C27B0' : (minder?.color ?? '#888'),
      });
      dayMap.set(dateKey, bucket);
    }

    // Add NOW marker into today
    const todayBucket = dayMap.get(todayStr) ?? [];
    todayBucket.push({ type: 'now', time: now });
    dayMap.set(todayStr, todayBucket);

    const result: TimelineSection[] = [];
    for (const [dateKey, items] of dayMap.entries()) {
      items.sort((a, b) => getItemTime(b) - getItemTime(a));
      result.push({ title: formatSectionTitle(dateKey), dateKey, data: items });
    }
    result.sort((a, b) => b.dateKey.localeCompare(a.dateKey));

    const todaySectionIdx = result.findIndex(s => s.dateKey === todayStr);
    const nowItemIdx =
      todaySectionIdx >= 0
        ? result[todaySectionIdx].data.findIndex(i => i.type === 'now')
        : -1;

    if (todaySectionIdx >= 0 && nowItemIdx >= 0) {
      scrollTarget.current = { sectionIndex: todaySectionIdx, itemIndex: nowItemIdx };
    }
    setSections(result);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void buildSections();
    }, [buildSections]),
  );

  useEffect(() => {
    if (!scrollTarget.current) return;
    const { sectionIndex, itemIndex } = scrollTarget.current;
    const timer = setTimeout(() => {
      try {
        listRef.current?.scrollToLocation({
          sectionIndex,
          itemIndex,
          viewPosition: 0.25,
          animated: false,
        });
      } catch {
        // ignore if items not yet measured
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [sections]);

  const handleRetroComplete = async (event: MinderEvent) => {
    const triggerAt = event.triggerAt ?? event.at;
    await addMinderEvent({
      id: `completed:${event.minderId}:${triggerAt}`,
      minderId: event.minderId,
      kind: 'completed',
      at: Date.now(),
      triggerAt,
    });
    void buildSections();
  };

  const renderDashboard = () => {
    if (minderStats.length === 0) return null;
    const totalCompleted = minderStats.reduce((s, m) => s + m.totalCompleted, 0);
    const rates = minderStats.map(m => m.completionRate).filter((r): r is number => r !== null);
    const avgRate = rates.length > 0 ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;
    const bestStreak = Math.max(...minderStats.map(m => m.streak), 0);

    return (
      <View style={[styles.dashboard, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <View style={styles.overallRow}>
          <View style={styles.overallPill}>
            <Text style={[styles.overallPillValue, { color: colors.primary }]}>{totalCompleted}</Text>
            <Text style={[styles.overallPillLabel, { color: colors.text }]}>done</Text>
          </View>
          <View style={[styles.pillDivider, { backgroundColor: colors.border }]} />
          <View style={styles.overallPill}>
            <Text style={[styles.overallPillValue, { color: colors.primary }]}>
              {avgRate !== null ? `${avgRate}%` : '—'}
            </Text>
            <Text style={[styles.overallPillLabel, { color: colors.text }]}>avg week</Text>
          </View>
          <View style={[styles.pillDivider, { backgroundColor: colors.border }]} />
          <View style={styles.overallPill}>
            <Text style={[styles.overallPillValue, { color: colors.primary }]}>{bestStreak}d</Text>
            <Text style={[styles.overallPillLabel, { color: colors.text }]}>best streak</Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
          {minderStats.map(({ minder, completionRate, streak }) => (
            <TouchableOpacity
              key={minder.id}
              style={[styles.minderChip, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => router.push(`/minder/${minder.id}`)}
              accessibilityLabel={`View stats for ${minder.name}`}
              accessibilityRole="button"
            >
              <View style={[styles.chipBar, { backgroundColor: minder.color }]} />
              <View style={styles.chipContent}>
                <Text style={[styles.chipName, { color: colors.text }]} numberOfLines={1}>
                  {minder.name}
                </Text>
                <View style={styles.chipStats}>
                  <Text style={[styles.chipRate, { color: colors.primary }]}>
                    {completionRate !== null ? `${completionRate}%` : '—'}
                  </Text>
                  {streak > 0 && (
                    <Text style={[styles.chipStreak, { color: colors.text }]}>🔥{streak}d</Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  };

  const renderNowMarker = (item: NowItem) => (
    <View style={styles.nowRow}>
      <View style={[styles.nowLine, { backgroundColor: colors.primary }]} />
      <Text style={[styles.nowLabel, { color: colors.primary }]}>NOW • {formatTime(item.time)}</Text>
      <View style={[styles.nowLine, { backgroundColor: colors.primary }]} />
    </View>
  );

  const renderScheduled = (item: ScheduledItem) => (
    <View style={[styles.itemRow, { opacity: 0.6 }]}>
      <View style={styles.timeCol}>
        <Text style={[styles.timeText, { color: colors.text }]}>{formatTime(item.time)}</Text>
      </View>
      <View style={styles.timeline}>
        <View style={[styles.tLine, { backgroundColor: colors.border }]} />
        <View style={[styles.tDot, { backgroundColor: item.minderColor }]} />
        <View style={[styles.tLine, { backgroundColor: colors.border }]} />
      </View>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.colorBar, { backgroundColor: item.minderColor }]} />
          <Text style={[styles.minderNameText, { color: colors.text }]} numberOfLines={1}>
            {item.minderName}
          </Text>
          <View style={[styles.badge, { borderColor: colors.border }]}>
            <Ionicons name="time-outline" size={11} color={colors.text} style={{ opacity: 0.6 }} />
            <Text style={[styles.badgeText, { color: colors.text, opacity: 0.6 }]}>Scheduled</Text>
          </View>
        </View>
      </View>
    </View>
  );

  const renderEvent = (item: EventItem) => {
    const { name: iconName, color: iconColor } = kindIconSpec(item.event.kind);
    const time = item.event.triggerAt ?? item.event.at;
    const isMissed = item.event.kind === 'missed';
    return (
      <View style={styles.itemRow}>
        <View style={styles.timeCol}>
          <Text style={[styles.timeText, { color: colors.text }]}>{formatTime(time)}</Text>
        </View>
        <View style={styles.timeline}>
          <View style={[styles.tLine, { backgroundColor: colors.border }]} />
          <View style={[styles.tDot, { backgroundColor: item.minderColor }]} />
          <View style={[styles.tLine, { backgroundColor: colors.border }]} />
        </View>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.colorBar, { backgroundColor: item.minderColor }]} />
            <Text style={[styles.minderNameText, { color: colors.text }]} numberOfLines={1}>
              {item.minderName}
            </Text>
            <View
              style={[
                styles.badge,
                { backgroundColor: `${iconColor}22`, borderColor: `${iconColor}55` },
              ]}
            >
              <Ionicons name={iconName} size={11} color={iconColor} />
              <Text style={[styles.badgeText, { color: iconColor }]}>
                {EVENT_LABELS[item.event.kind] ?? item.event.kind}
              </Text>
            </View>
          </View>
          {(item.event.kind === 'log' || item.event.kind === 'note') && (
            <View style={styles.cardBody}>
              {item.event.mood && (
                <Text style={[styles.moodText, { color: colors.text }]}>
                  {item.event.mood === 'good'
                    ? '😊 Good'
                    : item.event.mood === 'neutral'
                      ? '😐 Neutral'
                      : '😟 Not great'}
                </Text>
              )}
              {!!item.event.text && (
                <Text style={[styles.logText, { color: colors.text }]}>{item.event.text}</Text>
              )}
            </View>
          )}
          {isMissed && (
            <View style={styles.missedFooter}>
              <Text style={[styles.gentleText, { color: colors.text }]}>
                That's okay — every moment is a fresh start. 🌱
              </Text>
              <TouchableOpacity
                style={[styles.retroButton, { backgroundColor: `${colors.primary}22`, borderColor: colors.primary }]}
                onPress={() => handleRetroComplete(item.event)}
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
      </View>
    );
  };

  const renderItem = ({ item }: { item: TimelineItem }) => {
    if (item.type === 'now') return renderNowMarker(item);
    if (item.type === 'scheduled') return renderScheduled(item);
    return renderEvent(item);
  };

  const renderSectionHeader = ({
    section,
  }: {
    section: SectionListData<TimelineItem, TimelineSection>;
  }) => (
    <View style={[styles.sectionHeaderRow, { backgroundColor: colors.background }]}>
      <View style={[styles.sectionLine, { backgroundColor: colors.border }]} />
      <Text
        style={[
          styles.sectionTitleText,
          { color: colors.text, backgroundColor: colors.background },
        ]}
      >
        {section.title}
      </Text>
      <View style={[styles.sectionLine, { backgroundColor: colors.border }]} />
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      {renderDashboard()}
      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={item => {
          if (item.type === 'now') return 'now';
          if (item.type === 'scheduled') return `s:${item.id}`;
          return `e:${item.event.id}`;
        }}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="time-outline" size={40} color={colors.text} style={{ opacity: 0.3 }} />
            <Text style={[styles.emptyText, { color: colors.text }]}>No activity yet.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', padding: 60, gap: 12 },
  emptyText: { fontSize: 15, opacity: 0.5 },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  sectionLine: { flex: 1, height: 1 },
  sectionTitleText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 6,
  },

  nowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 6,
    marginHorizontal: 4,
    gap: 8,
  },
  nowLine: { flex: 1, height: 2, borderRadius: 1 },
  nowLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: 8,
    minHeight: 52,
  },
  timeCol: {
    width: 50,
    alignItems: 'flex-end',
    paddingTop: 14,
    paddingRight: 4,
  },
  timeText: { fontSize: 11, opacity: 0.55 },

  timeline: {
    width: 20,
    alignItems: 'center',
  },
  tLine: { flex: 1, width: 1.5 },
  tDot: { width: 9, height: 9, borderRadius: 5, marginVertical: 2 },

  card: {
    flex: 1,
    marginLeft: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  colorBar: { width: 3, height: 18, borderRadius: 2, flexShrink: 0 },
  minderNameText: { flex: 1, fontSize: 13, fontWeight: '700' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeText: { fontSize: 10, fontWeight: '600' },

  cardBody: { marginTop: 6, gap: 3 },
  moodText: { fontSize: 12, opacity: 0.75 },
  logText: { fontSize: 13, lineHeight: 19 },

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

  dashboard: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    gap: 8,
  },
  overallRow: { flexDirection: 'row', alignItems: 'center' },
  overallPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  overallPillValue: { fontSize: 15, fontWeight: '800' },
  overallPillLabel: { fontSize: 11, opacity: 0.55 },
  pillDivider: { width: 1, height: 18, marginHorizontal: 6 },
  chipScroll: { gap: 8 },
  minderChip: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
    width: 120,
    height: 50,
  },
  chipBar: { width: 4 },
  chipContent: { flex: 1, paddingHorizontal: 8, paddingVertical: 6, justifyContent: 'space-between' },
  chipName: { fontSize: 11, fontWeight: '700' },
  chipStats: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipRate: { fontSize: 15, fontWeight: '800' },
  chipStreak: { fontSize: 10, opacity: 0.65 },
});
