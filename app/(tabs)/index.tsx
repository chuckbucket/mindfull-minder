import { useState, useEffect } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../context/ThemeContext';
import { scheduleNotificationsForAllMinders } from '../../logic/NotificationManager';

const MINDERS_STORAGE_KEY = '@minders';

interface Minder {
  id: string;
  name: string;
  color: string;
  reminderFrequency: string;
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
  const { colors } = useTheme();
  const router = useRouter();

  useEffect(() => {
    scheduleNotificationsForAllMinders();
  }, []);

  const loadMinders = async () => {
    try {
      const storedMinders = await AsyncStorage.getItem(MINDERS_STORAGE_KEY);
      if (storedMinders !== null) {
        setMinders(JSON.parse(storedMinders));
      } else {
        setMinders([]);
      }
    } catch (error) {
      console.error('Error loading minders:', error);
    }
  };

  useFocusEffect(() => {
    loadMinders();
  });

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

  const renderMinderItem = ({ item }: { item: Minder }) => (
    <View style={[styles.minderItem, { backgroundColor: colors.card, borderLeftColor: item.color, borderLeftWidth: 5 }]}>
      <Text style={[styles.minderName, { color: colors.text }]}>{item.name}</Text>
      {item.reminderFrequency === 'Continuous' && (
        <View style={styles.continuousContainer}>
          <Text style={{ color: colors.text }}>Success Streak: {item.successStreak}</Text>
          <TouchableOpacity style={styles.failButton} onPress={() => handleFail(item.id)}>
            <Text style={styles.failButtonText}>Fail</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderExampleItem = ({ item }: { item: {id: string, name: string} }) => (
    <View style={[styles.exampleItem, { backgroundColor: colors.card }]}>
      <Text style={[styles.exampleName, { color: colors.text }]}>{item.name}</Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <TouchableOpacity
        style={[styles.addButton, { backgroundColor: colors.primary }]}
        onPress={() => router.push('/create-minder')}
      >
        <Text style={styles.addButtonText}>+ Add Minder</Text>
      </TouchableOpacity>

      {minders.length > 0 ? (
        <>
            <Text style={[styles.title, { color: colors.text }]}>Your Minders</Text>
            <FlatList
              data={minders}
              renderItem={renderMinderItem}
              keyExtractor={(item) => item.id}
              style={{ width: '100%' }}
              contentContainerStyle={{ paddingTop: 60 }}
            />
        </>
      ) : (
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  addButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    zIndex: 1,
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
    borderRadius: 8,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  minderName: {
    fontSize: 18,
    fontWeight: '500',
    flexShrink: 1,
  },
  continuousContainer: {
    alignItems: 'center',
    gap: 8,
  },
  failButton: {
    backgroundColor: 'red',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  failButtonText: {
    color: 'white',
    fontWeight: 'bold',
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
