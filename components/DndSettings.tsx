import React, { useState, useEffect } from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { scheduleNotificationsForAllMinders } from '../logic/NotificationManager';

const DND_ENABLED_KEY = '@dndEnabled';

const dndItems = [
  {
    id: 'evenings',
    title: 'Evenings (10pm - 8am)',
    startTime: '22:00',
    endTime: '08:00',
    days: [0, 1, 2, 3, 4, 5, 6], // Every day
  },
  {
    id: 'workday',
    title: 'Workday (8am - 5pm)',
    startTime: '08:00',
    endTime: '17:00',
    days: [1, 2, 3, 4, 5], // Mon-Fri
  },
  {
    id: 'weekends',
    title: 'Weekends',
    startTime: '00:00',
    endTime: '23:59',
    days: [0, 6], // Sunday, Saturday
  },
];

export const DND_SETTINGS_KEY = '@dndSettings';

export default function DndSettings() {
  const { colors } = useTheme();
  const [enabledSettings, setEnabledSettings] = useState<{[key: string]: boolean}>({});

  useEffect(() => {
    const storeFullDndSettings = async () => {
      await AsyncStorage.setItem(DND_SETTINGS_KEY, JSON.stringify(dndItems));
    }
    storeFullDndSettings();
    loadEnabledSettings();
  }, []);

  const loadEnabledSettings = async () => {
    try {
      const storedEnabled = await AsyncStorage.getItem(DND_ENABLED_KEY);
      if (storedEnabled) {
        setEnabledSettings(JSON.parse(storedEnabled));
      } else {
        const defaultEnabled: {[key: string]: boolean} = {};
        dndItems.forEach(item => defaultEnabled[item.id] = false);
        setEnabledSettings(defaultEnabled);
      }
    } catch (e) {
      console.error('Failed to load DND enabled settings.', e);
    }
  };

  const toggleSwitch = async (id: string) => {
    const newEnabledSettings = {
      ...enabledSettings,
      [id]: !enabledSettings[id],
    };
    setEnabledSettings(newEnabledSettings);
    try {
      await AsyncStorage.setItem(DND_ENABLED_KEY, JSON.stringify(newEnabledSettings));
      await scheduleNotificationsForAllMinders();
      alert('DND settings updated and notifications rescheduled.');
    } catch (e) {
      console.error('Failed to save DND enabled settings.', e);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]}>Do Not Disturb</Text>
      {dndItems.map((item) => (
        <View key={item.id} style={styles.dndItem}>
          <Text style={[styles.dndTitle, { color: colors.text }]}>{item.title}</Text>
          <Switch
            trackColor={{ false: '#767577', true: colors.primary }}
            thumbColor={enabledSettings[item.id] ? colors.primary : '#f4f3f4'}
            ios_backgroundColor="#3e3e3e"
            onValueChange={() => toggleSwitch(item.id)}
            value={enabledSettings[item.id] || false}
          />
        </View>
      ))}
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
    dndItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
    },
    dndTitle: {
        fontSize: 16,
    }
});
