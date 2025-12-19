import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, Button, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';

const DND_STORAGE_KEY = '@dndSettings';
const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface DndSettings {
  startTime: string;
  endTime: string;
  enabledDays: number[];
}

export default function DndSettings() {
  const { colors } = useTheme();
  const [settings, setSettings] = useState<DndSettings>({ startTime: '22:00', endTime: '06:00', enabledDays: [] });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const storedSettings = await AsyncStorage.getItem(DND_STORAGE_KEY);
      if (storedSettings) {
        setSettings(JSON.parse(storedSettings));
      }
    } catch (e) {
      console.error('Failed to load DND settings.', e);
    }
  };

  const saveSettings = async () => {
    try {
      await AsyncStorage.setItem(DND_STORAGE_KEY, JSON.stringify(settings));
      alert('DND settings saved!');
    } catch (e) {
      console.error('Failed to save DND settings.', e);
    }
  };

  const toggleDay = (dayIndex: number) => {
    const { enabledDays } = settings;
    const newEnabledDays = enabledDays.includes(dayIndex)
      ? enabledDays.filter(d => d !== dayIndex)
      : [...enabledDays, dayIndex];
    setSettings({ ...settings, enabledDays: newEnabledDays });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>Do Not Disturb</Text>
      <View style={styles.timeContainer}>
        <TextInput
          style={[styles.timeInput, { color: colors.text, borderColor: colors.border }]}
          value={settings.startTime}
          onChangeText={(text) => setSettings({ ...settings, startTime: text })}
        />
        <Text style={{ color: colors.text }}>to</Text>
        <TextInput
          style={[styles.timeInput, { color: colors.text, borderColor: colors.border }]}
          value={settings.endTime}
          onChangeText={(text) => setSettings({ ...settings, endTime: text })}
        />
      </View>
      <View style={styles.daysContainer}>
        {daysOfWeek.map((day, index) => (
          <TouchableOpacity
            key={index}
            style={[
              styles.dayButton,
              {
                backgroundColor: settings.enabledDays.includes(index) ? colors.primary : colors.background,
                borderColor: colors.border,
              }
            ]}
            onPress={() => toggleDay(index)}
          >
            <Text style={{ color: settings.enabledDays.includes(index) ? 'white' : colors.text }}>{day}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Button title="Save DND" onPress={saveSettings} color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginBottom: 16,
  },
  timeInput: {
    borderWidth: 1,
    borderRadius: 5,
    padding: 8,
    width: 80,
    textAlign: 'center',
  },
  daysContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  dayButton: {
    borderWidth: 1,
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
