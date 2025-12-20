
import { useState, useEffect } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../context/ThemeContext';
import { scheduleNotificationsForAllMinders } from '../../logic/NotificationManager';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';

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
  const { colors } = useTheme();
  const router = useRouter();

  useEffect(() => {
    scheduleNotificationsForAllMinders();
  }, []);

  const loadData = async () => {
    try {
      const storedMinders = await AsyncStorage.getItem(MINDERS_STORAGE_KEY);
      if (storedMinders !== null) {
        setMinders(JSON.parse(storedMinders));
      }
      const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();
      setNotifications(scheduledNotifications);
      const storedCompletions = await AsyncStorage.getItem(COMPLETIONS_STORAGE_KEY);
        if (storedCompletions) {
            setCompletions(JSON.parse(storedCompletions));
        }
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  useFocusEffect(() => {
    loadData();
  });

  const handleComplete = async (minderId: string) => {
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
        currentCompletions[minderId].push(Date.now());
        setCompletions(currentCompletions);
        await AsyncStorage.setItem(COMPLETIONS_STORAGE_KEY, JSON.stringify(currentCompletions));

        Alert.alert('Success', 'Minder marked as complete!');
        loadData();

    } catch (error) {
        console.error('Error completing minder:', error)
    }
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
        const isHandled = minderCompletions.some(compTime => compTime > pastDate.getTime());
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
            <TouchableOpacity
                style={styles.completeButton}
                onPress={() => handleComplete(item.id)}
                disabled={!isActionable}
            >
                <Ionicons name="checkmark-circle-outline" size={32} color={isActionable ? 'white' : 'rgba(255, 255, 255, 0.5)'} />
            </TouchableOpacity>
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
