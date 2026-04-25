
import { useState, useEffect, useCallback } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, Alert, Modal, TextInput } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../context/ThemeContext';
import { scheduleNotificationsForAllMinders } from '../../logic/NotificationManager';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { addMinderEvent, getAllMinderEvents, upsertMissedEvents } from '../../logic/MinderEvents';

const MINDERS_STORAGE_KEY = '@minders';
const COMPLETIONS_STORAGE_KEY = '@completions';

interface Minder {
  id: string;
  name: string;
  color: string;
  reminderFrequency: string;
  quantity: number;
  note?: string;
  successStreak?: number;
}

const exampleMinders = [
    { id: '1', name: 'Check in with a friend today.' },
    { id: '2', name: 'Take a 5-minute sensory break: listen to calming music or use a weighted blanket.' },
    { id: '3', name: 'Break down a large task into smaller steps.' },
    { id: '4', name: "Am I feeling overwhelmed? It's okay to take a break." },
];

export default function HomeScreen() {
  const [minders, setMinders] = useState<Minder[]>([]);
  const [notifications, setNotifications] = useState<Notifications.Notification[]>([]);
  const [completions, setCompletions] = useState<{[key: string]: number[]}>({});
  const [handledTriggerAtsByMinder, setHandledTriggerAtsByMinder] = useState<Record<string, number[]>>({});
  const [triggeredTriggerAtsByMinder, setTriggeredTriggerAtsByMinder] = useState<Record<string, number[]>>({});
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [noteMinderId, setNoteMinderId] = useState<string | null>(null);
  const [noteTriggerAt, setNoteTriggerAt] = useState<number | undefined>(undefined);
  const [noteMood, setNoteMood] = useState<'good' | 'neutral' | 'bad'>('neutral');
  const { colors } = useTheme();
  const router = useRouter();

  useEffect(() => {
    scheduleNotificationsForAllMinders();
  }, []);

  const getClosestTriggerAtWithinWindow = useCallback(
    (minderId: string, atMs: number, windowMs: number) => {
      const candidates: number[] = [];

      const scheduled = (notifications as any[])
        .filter(n => n?.content?.data?.minderId === minderId)
        .map(n => n?.trigger?.date)
        .filter(Boolean)
        .map((d: any) => new Date(d).getTime())
        .filter((t: any) => typeof t === 'number' && !Number.isNaN(t)) as number[];
      candidates.push(...scheduled);

      const triggered = triggeredTriggerAtsByMinder[minderId] || [];
      candidates.push(...triggered);

      if (candidates.length === 0) return undefined;

      let best: number | undefined;
      let bestDiff = Infinity;
      for (const t of candidates) {
        const diff = Math.abs(t - atMs);
        if (diff < bestDiff) {
          best = t;
          bestDiff = diff;
        }
      }
      if (bestDiff <= windowMs) return best;
      return undefined;
    },
    [notifications, triggeredTriggerAtsByMinder],
  );

  const syncMissedReminders = useCallback(
    async (
      loadedMinders: Minder[],
      scheduled: any[],
      loadedCompletions: { [key: string]: number[] },
      handledTriggerAtsSnapshot: Record<string, Set<number>>,
    ) => {
      const now = Date.now();
      const missedByMinder: Record<string, number[]> = {};

      for (const notif of scheduled) {
        const minderId = notif?.content?.data?.minderId;
        const triggerDateValue = notif?.trigger?.date;
        if (!minderId || !triggerDateValue) continue;

        const triggerAt = new Date(triggerDateValue).getTime();
        if (Number.isNaN(triggerAt) || triggerAt > now) continue;

        const minder = loadedMinders.find(m => m.id === minderId);
        if (!minder || minder.reminderFrequency === 'Continuous') continue;

        if ((handledTriggerAtsSnapshot[minderId]?.has(triggerAt) ?? false)) continue;
        const legacy = loadedCompletions[minderId] || [];
        if (legacy.some(compTime => compTime > triggerAt)) continue;

        missedByMinder[minderId] = missedByMinder[minderId] || [];
        missedByMinder[minderId].push(triggerAt);
      }

      await Promise.all(Object.entries(missedByMinder).map(([minderId, triggerAts]) => upsertMissedEvents(minderId, triggerAts)));
    },
    [],
  );

  const loadData = async () => {
    try {
      const storedMinders = await AsyncStorage.getItem(MINDERS_STORAGE_KEY);
      const loadedMinders = storedMinders ? (JSON.parse(storedMinders) as Minder[]) : [];
      setMinders(loadedMinders);

      const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();
      setNotifications(scheduledNotifications);

      const storedCompletions = await AsyncStorage.getItem(COMPLETIONS_STORAGE_KEY);
      const loadedCompletions = storedCompletions ? (JSON.parse(storedCompletions) as { [key: string]: number[] }) : {};
      setCompletions(loadedCompletions);

      const allEvents = await getAllMinderEvents();
      const handledMap: Record<string, Set<number>> = {};
      const triggeredMap: Record<string, Set<number>> = {};
      for (const event of allEvents) {
        if (typeof event.triggerAt !== 'number') continue;
        if (event.kind === 'triggered') {
          triggeredMap[event.minderId] = triggeredMap[event.minderId] || new Set<number>();
          triggeredMap[event.minderId].add(event.triggerAt);
        }
        if (event.kind === 'completed' || event.kind === 'log' || event.kind === 'note') {
          handledMap[event.minderId] = handledMap[event.minderId] || new Set<number>();
          handledMap[event.minderId].add(event.triggerAt);
        }
      }
      setHandledTriggerAtsByMinder(Object.fromEntries(Object.entries(handledMap).map(([id, set]) => [id, Array.from(set.values())])));
      setTriggeredTriggerAtsByMinder(
        Object.fromEntries(Object.entries(triggeredMap).map(([id, set]) => [id, Array.from(set.values())])),
      );

      await syncMissedReminders(loadedMinders, scheduledNotifications as any[], loadedCompletions, handledMap);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  useFocusEffect(() => {
    loadData();
  });

  const handleComplete = async (minderId: string, triggerAt?: number) => {
    try {
        const updatedMinders = minders.map(minder => {
            if (minder.id === minderId && minder.reminderFrequency === 'Continuous') {
                return { ...minder, successStreak: (minder.successStreak || 0) + 1 };
            }
            return minder;
        });
        setMinders(updatedMinders);
        await AsyncStorage.setItem(MINDERS_STORAGE_KEY, JSON.stringify(updatedMinders));

        const storedCompletions = await AsyncStorage.getItem(COMPLETIONS_STORAGE_KEY);
        const currentCompletions = storedCompletions ? JSON.parse(storedCompletions) : {};
        if (!currentCompletions[minderId]) {
            currentCompletions[minderId] = [];
        }
        const completedAt = Date.now();
        currentCompletions[minderId].push(completedAt);
        setCompletions(currentCompletions);
        await AsyncStorage.setItem(COMPLETIONS_STORAGE_KEY, JSON.stringify(currentCompletions));

        await addMinderEvent({
          minderId,
          kind: 'completed',
          at: completedAt,
          triggerAt,
        });

        Alert.alert('Success', 'Minder marked as complete!');
        loadData();

    } catch (error) {
        console.error('Error completing minder:', error)
    }
  };

  const openNoteModal = (minderId: string, preferredTriggerAt?: number) => {
    setNoteMinderId(minderId);
    setNoteText('');
    setNoteMood('neutral');

    const minder = minders.find(m => m.id === minderId);
    if (!minder || minder.reminderFrequency === 'Continuous') {
      setNoteTriggerAt(undefined);
      setNoteModalVisible(true);
      return;
    }

    if (typeof preferredTriggerAt === 'number') {
      setNoteTriggerAt(preferredTriggerAt);
      setNoteModalVisible(true);
      return;
    }

    const now = Date.now();
    const candidateTriggerAts = (notifications as any[])
      .filter(n => n?.content?.data?.minderId === minderId)
      .map(n => n?.trigger?.date)
      .filter(Boolean)
      .map((d: any) => new Date(d).getTime())
      .filter((t: any) => typeof t === 'number' && !Number.isNaN(t)) as number[];

    if (candidateTriggerAts.length === 0) {
      const manualAt = Date.now();
      setNoteTriggerAt(manualAt);
      void addMinderEvent({ id: `triggered:${minderId}:${manualAt}`, minderId, kind: 'triggered', at: manualAt, triggerAt: manualAt });
    } else {
      candidateTriggerAts.sort((a, b) => Math.abs(a - now) - Math.abs(b - now));
      setNoteTriggerAt(candidateTriggerAts[0]);
    }
    setNoteModalVisible(true);
  };

  const saveNote = async () => {
    if (!noteMinderId) return;
    const trimmed = noteText.trim();
    if (!trimmed) {
      setNoteModalVisible(false);
      return;
    }

    const minder = minders.find(m => m.id === noteMinderId);
    const logAt = Date.now();
    let triggerAtForLog = noteTriggerAt;

    if (minder && minder.reminderFrequency !== 'Continuous') {
      const snapped = getClosestTriggerAtWithinWindow(noteMinderId, logAt, 15 * 60 * 1000);
      if (typeof snapped === 'number') {
        triggerAtForLog = snapped;
        void addMinderEvent({
          id: `completed:${noteMinderId}:${snapped}`,
          minderId: noteMinderId,
          kind: 'completed',
          at: logAt,
          triggerAt: snapped,
        });
      }
    }

    if (minder && minder.reminderFrequency !== 'Continuous' && typeof triggerAtForLog !== 'number') {
      const manualAt = logAt;
      triggerAtForLog = manualAt;
      void addMinderEvent({
        id: `triggered:${noteMinderId}:${manualAt}`,
        minderId: noteMinderId,
        kind: 'triggered',
        at: manualAt,
        triggerAt: manualAt,
      });
    }

    await addMinderEvent({
      minderId: noteMinderId,
      kind: 'log',
      at: logAt,
      text: trimmed,
      triggerAt: triggerAtForLog,
      mood: noteMood,
    });
    setNoteModalVisible(false);
    void loadData();
  };

  const handleFail = async (minderId: string) => {
    try {
      const updatedMinders = minders.map(minder => {
        if (minder.id === minderId) {
          return { ...minder, successStreak: 0 };
        }
        return minder;
      });
      setMinders(updatedMinders);
      await AsyncStorage.setItem(MINDERS_STORAGE_KEY, JSON.stringify(updatedMinders));
    } catch (error) {
      console.error('Error updating minder:', error);
      Alert.alert('Error', 'Failed to update the minder.');
    }
  };

  const getNextTriggerInfo = (minderId: string) => {
    const now = new Date();
    const minderNotifications = notifications
        .filter(notif => notif.content.data.minderId === minderId)
        .map(notif => {
            const triggerDateValue = (notif.trigger as any).date;
            if (!triggerDateValue) return null;
            return new Date(triggerDateValue);
        })
        .filter(date => date !== null) as Date[];

    const pastNotifications = minderNotifications
        .filter(date => date <= now)
        .sort((a, b) => b.getTime() - a.getTime());

    const futureNotifications = minderNotifications
        .filter(date => date > now)
        .sort((a, b) => a.getTime() - b.getTime());

    const minderCompletions = completions[minderId] || [];

    for (const pastDate of pastNotifications) {
        const triggerAt = pastDate.getTime();
        const isHandled =
          (handledTriggerAtsByMinder[minderId] || []).includes(triggerAt) || minderCompletions.some(compTime => compTime > triggerAt);
        if (!isHandled) {
            return { date: pastDate, isPastDue: true };
        }
    }

    if (futureNotifications.length > 0) {
        return { date: futureNotifications[0], isPastDue: false };
    }

        return { date: null, isPastDue: false };
};

const formatTimeUntil = (date: Date | null) => {
    if (!date) return "Not scheduled";
    
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();

    if (diffMs < 0) {
      return "Past due";
    }

    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const remainingMins = diffMins % 60;

    if (diffHours > 0) {
      return `Due in ${diffHours}h ${remainingMins}m`;
    }
    if (diffMins > 0) {
      return `Due in ${diffMins}m`;
    }
    return "Due now";
};


  const renderMinderItem = ({ item }: { item: Minder }) => {
    const triggerInfo = getNextTriggerInfo(item.id);
    const now = new Date();
    const diffMs = triggerInfo.date ? triggerInfo.date.getTime() - now.getTime() : -1;
    const isActionable = triggerInfo.isPastDue || (triggerInfo.date && diffMs > 0 && diffMs <= 60 * 60 * 1000);
    const triggerAt = triggerInfo.date ? triggerInfo.date.getTime() : undefined;

    const handleLongPress = () => {
        router.push({ pathname: '/create-minder', params: { minderId: item.id } });
    };

    return (
    <TouchableOpacity onLongPress={handleLongPress} activeOpacity={0.8}>
    <View style={[styles.minderItem, { backgroundColor: item.color }]}>
      <View style={styles.minderContent}>
        <Text style={[styles.minderName, { color: 'white' }]}>{item.name}</Text>
        {item.note && <Text style={[styles.minderNote, { color: 'white' }]}>Note: {item.note}</Text>}
        
        {item.reminderFrequency !== 'Continuous' && (
            <>
                <Text style={[styles.minderNote, { color: 'white', marginTop: 8 }]}>
                    {item.reminderFrequency}, {item.quantity} times
                </Text>
                <Text style={[styles.minderNote, { color: triggerInfo.isPastDue ? '#ffdddd' : 'white' }]}>
                    {formatTimeUntil(triggerInfo.date)}
                </Text>
            </>
        )}

        {item.reminderFrequency === 'Continuous' && (
            <View style={styles.continuousContainer}>
                <Text style={{ color: 'white' }}>Success Streak: {item.successStreak || 0}</Text>
                <View style={styles.continuousButtons}>
                  <TouchableOpacity style={[styles.button, {backgroundColor: 'rgba(255, 255, 255, 0.3)'}]} onPress={() => openNoteModal(item.id)}>
                      <Text style={styles.buttonText}>Log</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.button, {backgroundColor: 'rgba(255, 255, 255, 0.3)'}]} onPress={() => router.push(`/minder/${item.id}`)}>
                      <Text style={styles.buttonText}>History</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={[styles.button, {backgroundColor: 'rgba(255, 255, 255, 0.3)'}]} onPress={() => handleComplete(item.id)}>
                    <Text style={styles.buttonText}>Success</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, styles.failButton]} onPress={() => handleFail(item.id)}>
                    <Text style={styles.buttonText}>Fail</Text>
                </TouchableOpacity>
            </View>
        )}
      </View>
      {item.reminderFrequency !== 'Continuous' && (
            <View style={styles.rightActions}>
              <TouchableOpacity style={styles.iconButton} onPress={() => openNoteModal(item.id, triggerAt)}>
                <Ionicons name="create-outline" size={20} color="white" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconButton} onPress={() => router.push(`/minder/${item.id}`)}>
                <Ionicons name="time-outline" size={20} color="white" />
              </TouchableOpacity>
              <TouchableOpacity
                  style={styles.completeButton}
                  onPress={() => handleComplete(item.id, triggerAt)}
                  disabled={!isActionable}
              >
                <Ionicons name="checkmark-circle-outline" size={32} color={isActionable ? 'white' : 'rgba(255, 255, 255, 0.5)'} />
              </TouchableOpacity>
            </View>
      )}
    </View>
    </TouchableOpacity>
  )};

  const renderExampleItem = ({ item }: { item: {id: string, name: string} }) => (
    <View style={[styles.exampleItem, { backgroundColor: colors.card }]}>
      <Text style={[styles.exampleName, { color: colors.text }]}>{item.name}</Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={minders}
        renderItem={renderMinderItem}
        keyExtractor={(item) => item.id}
        style={{ width: '100%' }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Your Minders</Text>
            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: colors.primary }]}
              onPress={() => router.push('/create-minder')}
            >
              <Text style={styles.addButtonText}>+ Add Minder</Text>
            </TouchableOpacity>
          </View>
        }
        ListEmptyComponent={
          <View style={{width: '100%'}}>
            <Text style={[styles.title, { color: colors.text, marginTop: 60 }]}>No Minders Yet</Text>
            <Text style={[styles.subtitle, { color: colors.text }]}>Here are some ideas to get you started:</Text>
            <FlatList
                data={exampleMinders}
                renderItem={renderExampleItem}
                keyExtractor={(item) => item.id}
                style={{ width: '100%' }}
              />
          </View>
        }
      />

      <Modal
        transparent
        animationType="fade"
        visible={noteModalVisible}
        onRequestClose={() => setNoteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Add a quick log</Text>
            {typeof noteTriggerAt === 'number' && (
              <Text style={{ color: colors.text, opacity: 0.8, marginBottom: 10 }}>
                For reminder: {new Date(noteTriggerAt).toLocaleString()}
              </Text>
            )}
            <View style={styles.moodRow}>
              {(['good', 'neutral', 'bad'] as const).map(mood => (
                <TouchableOpacity
                  key={mood}
                  onPress={() => setNoteMood(mood)}
                  style={[
                    styles.moodButton,
                    {
                      backgroundColor: noteMood === mood ? colors.primary : colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={{ color: noteMood === mood ? 'white' : colors.text, fontWeight: '700' }}>
                    {mood === 'good' ? 'Good' : mood === 'neutral' ? 'Neutral' : 'Bad'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              value={noteText}
              onChangeText={setNoteText}
              placeholder="What do you want to reflect on?"
              placeholderTextColor={colors.text}
              multiline
              style={[styles.modalInput, { color: colors.text, borderColor: colors.border }]}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                onPress={() => setNoteModalVisible(false)}
                style={[styles.modalButton, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveNote} style={[styles.modalButton, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                <Text style={{ color: 'white', fontWeight: '700' }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
  },
  header: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  addButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  addButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  minderItem: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.23,
    shadowRadius: 2.62,
    elevation: 4,
  },
  minderContent: {
      flex: 1,
      marginRight: 16,
  },
  minderName: {
    fontSize: 18,
    fontWeight: 'bold',
    flexShrink: 1,
  },
  minderNote: {
      fontSize: 14,
      marginTop: 4,
      opacity: 0.9,
  },
  continuousContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
  continuousButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  failButton: {
    backgroundColor: 'rgba(255, 80, 80, 0.8)',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  completeButton: {
    paddingLeft: 16,
  },
  rightActions: {
    alignItems: 'center',
    gap: 10,
    paddingLeft: 12,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: '#00000055',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
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
  modalInput: {
    minHeight: 90,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  modalButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  exampleItem: {
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  exampleName: {
    fontSize: 16,
    fontStyle: 'italic',
  },
});
