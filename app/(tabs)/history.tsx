import { useCallback, useRef, useState } from 'react';
import {
  SectionList,
  SectionListData,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { getAllMinderEvents, MinderEvent } from '../../logic/MinderEvents';

const MINDERS_STORAGE_KEY = '@minders';

type Minder = { id: string; name: string; color: string; reminderFrequency: string };

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
  const [sections, setSections] = useState<TimelineSection[]>([]);
  const listRef = useRef<SectionList<TimelineItem, TimelineSection>>(null);
  const scrollTarget = useRef<{ sectionIndex: number; itemIndex: number } | null>(null);
  const didScroll = useRef(false);

  const buildSections = useCallback(async () => {
    const now = Date.now();
    const todayStr = toLocalDateKey(now);

    const stored = await AsyncStorage.getItem(MINDERS_STORAGE_KEY);
    const minders: Minder[] = stored ? JSON.parse(stored) : [];
    const minderMap = new Map(minders.map(m => [m.id, m]));

    const dayMap = new Map<string, TimelineItem[]>();

    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const notif of scheduled) {
      const minderId = (notif.content.data as any)?.minderId as string | undefined;
      if (!minderId) continue;
      const t = notif.trigger as any;
      const raw = t?.value ?? t?.timestamp ?? t?.date;
      if (!raw) continue;
      const time = typeof raw === 'number' ? raw : new Date(raw).getTime();
      if (isNaN(time)) continue;
      const dateKey = toLocalDateKey(time);
      const minder = minderMap.get(minderId);
      const bucket = dayMap.get(dateKey) ?? [];
      bucket.push({
        type: 'scheduled',
        time,
        minderId,
        minderName: minder?.name ?? 'Unknown',
        minderColor: minder?.color ?? '#888',
        id: notif.identifier,
      });
      dayMap.set(dateKey, bucket);
    }

    const allEvents = await getAllMinderEvents();
    for (const event of allEvents) {
      if (event.kind === 'triggered') continue;
      const time = event.triggerAt ?? event.at;
      const dateKey = toLocalDateKey(time);
      const minder = minderMap.get(event.minderId);
      const bucket = dayMap.get(dateKey) ?? [];
      bucket.push({
        type: 'event',
        event,
        minderName: minder?.name ?? 'Unknown',
        minderColor: minder?.color ?? '#888',
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
    didScroll.current = false;
    setSections(result);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void buildSections();
    }, [buildSections]),
  );

  const handleLayout = useCallback(() => {
    if (didScroll.current || !scrollTarget.current) return;
    didScroll.current = true;
    const { sectionIndex, itemIndex } = scrollTarget.current;
    setTimeout(() => {
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
    }, 80);
  }, []);

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
                      : '😟 Bad'}
                </Text>
              )}
              {!!item.event.text && (
                <Text style={[styles.logText, { color: colors.text }]}>{item.event.text}</Text>
              )}
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
        onLayout={handleLayout}
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
});
