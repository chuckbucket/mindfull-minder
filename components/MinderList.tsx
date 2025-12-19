import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '../context/ThemeContext';

const MINDERS_STORAGE_KEY = '@minders';

interface Minder {
  id: string;
  name: string;
  color: string;
  note?: string;
  reminderFrequency: string;
  quantity?: string;
  distribution?: string;
  preventDnd?: boolean;
  completed?: boolean; // New property
}

export default function MinderList() {
  const { colors } = useTheme();
  const [minders, setMinders] = useState<Minder[]>([]);
  const router = useRouter();

  const loadMinders = async () => {
    try {
      const storedMinders = await AsyncStorage.getItem(MINDERS_STORAGE_KEY);
      if (storedMinders) {
        setMinders(JSON.parse(storedMinders));
      }
    } catch (e) {
      console.error('Failed to load minders.', e);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadMinders();
    }, [])
  );

  const toggleComplete = async (minderId: string) => {
    try {
      const newMinders = minders.map(minder =>
        minder.id === minderId ? { ...minder, completed: !minder.completed } : minder
      );
      setMinders(newMinders);
      await AsyncStorage.setItem(MINDERS_STORAGE_KEY, JSON.stringify(newMinders));
    } catch (e) {
      console.error('Failed to update minder completion status.', e);
      Alert.alert('Error', 'Failed to update minder status.');
    }
  };

  const renderItem = ({ item }: { item: Minder }) => (
    <View style={[styles.minderItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.minderName, { color: colors.text }]}>{item.name}</Text>
        <Text style={{ color: colors.text }}>{item.reminderFrequency}</Text>
      </View>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: item.completed ? 'gray' : colors.primary }]}
        onPress={() => toggleComplete(item.id)}
      >
        <Text style={styles.buttonText}>{item.completed ? 'Undo' : 'Complete'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary, marginLeft: 8 }]}
        onPress={() => router.push(`/create-minder?minderId=${item.id}`)}
      >
        <Text style={styles.buttonText}>Edit</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={{ width: '100%' }}>
      <Text style={[styles.title, { color: colors.text }]}>All Minders</Text>
      <FlatList
        data={minders}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  minderItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  minderName: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 5,
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
});
