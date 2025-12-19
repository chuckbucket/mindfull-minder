import { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, Switch, TouchableOpacity, Alert, Platform } from 'react-native';
import SegmentedControl from '@react-native-segmented-control/segmented-control';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../context/ThemeContext';
import { scheduleNotificationsForMinder, cancelNotificationsForMinder } from '../logic/NotificationManager';

const MINDERS_STORAGE_KEY = '@minders';

export default function CreateMinderScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { minderId } = useLocalSearchParams();

  const [name, setName] = useState('');
  const [color, setColor] = useState(colors.palette.blue);
  const [note, setNote] = useState('');
  const [reminderFrequencyIndex, setReminderFrequencyIndex] = useState(0);
  const [quantity, setQuantity] = useState('1');
  const [distributionIndex, setDistributionIndex] = useState(0);
  const [preventDnd, setPreventDnd] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [minders, setMinders] = useState<any[]>([]);

  const reminderFrequencies = ['Daily', 'Weekly', 'X per day', 'X per week', 'Continuous'];
  const distributions = ['Equally Spread', 'Random'];
  const colorPalette = Object.values(colors.palette);

  useEffect(() => {
    const loadMindersForStreak = async () => {
        const storedMinders = await AsyncStorage.getItem(MINDERS_STORAGE_KEY);
        if (storedMinders) {
            setMinders(JSON.parse(storedMinders))
        }
    }
    loadMindersForStreak()
    if (minderId) {
      setIsEditMode(true);
      loadMinder(minderId as string);
    }
  }, [minderId]);

  const loadMinder = async (id: string) => {
    try {
      const storedMinders = await AsyncStorage.getItem(MINDERS_STORAGE_KEY);
      if (storedMinders) {
        const minders = JSON.parse(storedMinders);
        const minderToEdit = minders.find((m: any) => m.id === id);
        if (minderToEdit) {
          setName(minderToEdit.name);
          setColor(minderToEdit.color);
          setNote(minderToEdit.note);
          setReminderFrequencyIndex(reminderFrequencies.indexOf(minderToEdit.reminderFrequency));
          setQuantity(minderToEdit.quantity || '1');
          setDistributionIndex(distributions.indexOf(minderToEdit.distribution || 'Equally Spread'));
          setPreventDnd(minderToEdit.preventDnd || false);
        }
      }
    } catch (e) {
      console.error('Failed to load minder for editing.', e);
    }
  };

  const saveMinder = async () => {
    if (!name) {
      Alert.alert('Error', 'Please enter a name for the minder.');
      return;
    }

    const isContinuous = reminderFrequencies[reminderFrequencyIndex] === 'Continuous';
    const newMinderId = isEditMode ? minderId : Crypto.randomUUID();

    const minderData = {
      id: newMinderId,
      name,
      color,
      note,
      reminderFrequency: reminderFrequencies[reminderFrequencyIndex],
      quantity: reminderFrequencyIndex > 1 && !isContinuous ? quantity : null,
      distribution: reminderFrequencyIndex > 1 && !isContinuous ? distributions[distributionIndex] : null,
      preventDnd,
      successStreak: isContinuous ? (isEditMode ? (minders.find((m: any) => m.id === minderId)?.successStreak || 0) : 0) : null,
    };

    try {
      const existingMinders = await AsyncStorage.getItem(MINDERS_STORAGE_KEY);
      const currentMinders = existingMinders ? JSON.parse(existingMinders) : [];
      if (isEditMode) {
        const index = currentMinders.findIndex((m: any) => m.id === minderId);
        currentMinders[index] = minderData;
      } else {
        currentMinders.push(minderData);
      }
      await AsyncStorage.setItem(MINDERS_STORAGE_KEY, JSON.stringify(currentMinders));

      if (!isContinuous) {
        await scheduleNotificationsForMinder(minderData);
      } else {
        await cancelNotificationsForMinder(minderData.id as string);
      }

      Alert.alert('Success', `Minder ${isEditMode ? 'updated' : 'saved'}!`, [
        { text: 'OK', onPress: () => router.push('/(tabs)') },
      ]);
    } catch (error) {
      console.error('Error saving minder:', error);
      Alert.alert('Error', 'There was an error saving the minder.');
    }
  };
  
  const deleteMinder = async () => {
    if (!minderId) return;

    Alert.alert(
        'Delete Minder',
        'Are you sure you want to delete this minder?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
                try {
                    await cancelNotificationsForMinder(minderId as string);
                    const existingMinders = await AsyncStorage.getItem(MINDERS_STORAGE_KEY);
                    const minders = existingMinders ? JSON.parse(existingMinders) : [];
                    const newMinders = minders.filter((m: any) => m.id !== minderId);
                    await AsyncStorage.setItem(MINDERS_STORAGE_KEY, JSON.stringify(newMinders));
                    Alert.alert('Success', 'Minder deleted!', [
                      { text: 'OK', onPress: () => router.push('/(tabs)') },
                    ]);
                  } catch (error) {
                    console.error('Error deleting minder:', error);
                    Alert.alert('Error', 'There was an error deleting the minder.');
                  }
            }
          }
        ]
      )
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>{isEditMode ? 'Edit Minder' : 'Create a New Minder'}</Text>
      
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
        placeholder="Minder Name"
        placeholderTextColor={colors.text}
        value={name}
        onChangeText={setName}
      />
      
      <View style={styles.colorContainer}>
        <Text style={[styles.label, { color: colors.text }]}>Color:</Text>
        <View style={styles.colorPalette}>
          {colorPalette.map(c => (
            <TouchableOpacity 
              key={c}
              style={[styles.colorSwatch, { backgroundColor: c, borderColor: color === c ? colors.primary : colors.border }]}
              onPress={() => setColor(c)}
            />
          ))}
        </View>
      </View>

      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.border, height: 100 }]}
        placeholder="Notes"
        placeholderTextColor={colors.text}
        value={note}
        onChangeText={setNote}
        multiline
      />

      <Text style={[styles.label, { color: colors.text }]}>Reminder Criteria</Text>
      <SegmentedControl
        values={reminderFrequencies}
        selectedIndex={reminderFrequencyIndex}
        onChange={(event) => {
          setReminderFrequencyIndex(event.nativeEvent.selectedSegmentIndex);
        }}
      />

      {(reminderFrequencyIndex === 2 || reminderFrequencyIndex === 3) && (
        <>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border }]}
            placeholder="Quantity"
            placeholderTextColor={colors.text}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="numeric"
          />
          <SegmentedControl
            values={distributions}
            selectedIndex={distributionIndex}
            onChange={(event) => {
              setDistributionIndex(event.nativeEvent.selectedSegmentIndex);
            }}
          />
        </>
      )}

      <View style={styles.dndContainer}>
        <Text style={[styles.label, { color: colors.text }]}>Prevent during DND</Text>
        <Switch
          value={preventDnd}
          onValueChange={setPreventDnd}
          thumbColor={colors.primary}
        />
      </View>
      
      <TouchableOpacity style={[styles.saveButton, { backgroundColor: colors.primary }]} onPress={saveMinder}>
        <Text style={styles.saveButtonText}>{isEditMode ? 'Update Minder' : 'Save Minder'}</Text>
      </TouchableOpacity>
      
      {isEditMode && (
        <TouchableOpacity style={[styles.saveButton, { backgroundColor: 'red', marginTop: 16 }]} onPress={deleteMinder}>
          <Text style={styles.saveButtonText}>Delete Minder</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 24,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    width: '100%',
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  colorContainer: {
    marginBottom: 16,
  },
  colorPalette: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  colorSwatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
  },
  dndContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
  },
  saveButton: {
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 32,
  },
  saveButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 18,
  },
});
