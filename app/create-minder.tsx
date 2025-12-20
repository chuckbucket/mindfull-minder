import { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, Switch, ScrollView, Modal, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { scheduleNotificationsForMinder } from '../logic/NotificationManager';
import { log } from '../logic/Logger';
import 'react-native-get-random-values';

const MINDERS_STORAGE_KEY = '@minders';
const DND_ENABLED_KEY = '@dndEnabled';
const DND_SETTINGS_KEY = '@dndSettings';

const colorsOptions = ['#FF6B6B', '#FFD166', '#06D6A0', '#118AB2', '#073B4C'];
const frequencyOptions = ['Continuous', 'Daily', 'Weekly'];
const intervalOptions = ['Equal', 'Random'];

export default function CreateMinderScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const [minderId, setMinderId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState(colorsOptions[0]);
  const [reminderFrequency, setReminderFrequency] = useState(frequencyOptions[1]);
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [scheduleAroundDnd, setScheduleAroundDnd] = useState(true);
  const [intervalType, setIntervalType] = useState(intervalOptions[0]);
  const [triggerTimesPreview, setTriggerTimesPreview] = useState<Date[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (params.minderId) {
      log.info(`Loading minder with ID: ${params.minderId}`);
      setMinderId(params.minderId as string);
      loadMinderData(params.minderId as string);
    }
  }, [params.minderId]);

  const loadMinderData = async (id: string) => {
    const storedMinders = await AsyncStorage.getItem(MINDERS_STORAGE_KEY);
    if (storedMinders) {
      const minders = JSON.parse(storedMinders);
      const minderToEdit = minders.find((m: any) => m.id === id);
      if (minderToEdit) {
        setName(minderToEdit.name);
        setSelectedColor(minderToEdit.color);
        setReminderFrequency(minderToEdit.reminderFrequency);
        setQuantity(minderToEdit.quantity.toString());
        setNote(minderToEdit.note || '');
        setScheduleAroundDnd(minderToEdit.scheduleAroundDnd || true);
        setIntervalType(minderToEdit.intervalType || intervalOptions[0]);
      }
    }
  };

  useEffect(() => {
    if (reminderFrequency !== 'Continuous') {
      calculateTriggerTimesPreview();
    }
  }, [name, reminderFrequency, quantity, scheduleAroundDnd, intervalType]);

  const calculateTriggerTimesPreview = async () => {
    const dndSettingsEnabled = scheduleAroundDnd ? await AsyncStorage.getItem(DND_ENABLED_KEY) : null;
    const dndSettings = scheduleAroundDnd ? await AsyncStorage.getItem(DND_SETTINGS_KEY) : null;
    const enabled = dndSettingsEnabled ? JSON.parse(dndSettingsEnabled) : {};
    const allSettings = dndSettings ? JSON.parse(dndSettings) : [];

    const isDndActive = (time: Date) => {
        if (!scheduleAroundDnd) return false;
        const dayOfWeek = time.getDay();
        const currentTime = time.getHours() * 60 + time.getMinutes();
        for (const setting of allSettings) {
            if (enabled[setting.id] && setting.days.includes(dayOfWeek)) {
                const [startHour, startMinute] = setting.startTime.split(':').map(Number);
                const [endHour, endMinute] = setting.endTime.split(':').map(Number);
                const startTime = startHour * 60 + startMinute;
                const endTime = endHour * 60 + endMinute;
                if (startTime <= endTime) {
                    if (currentTime >= startTime && currentTime <= endTime) return true;
                } else {
                    if (currentTime >= startTime || currentTime <= endTime) return true;
                }
            }
        }
        return false;
    };

    const now = new Date();
    let times: Date[] = [];
    const totalQuantity = parseInt(quantity, 10) || 1;

    let interval, timeSpan;
    if (reminderFrequency === 'Daily') {
        timeSpan = 24 * 60 * 60 * 1000;
    } else { // Weekly
        timeSpan = 7 * 24 * 60 * 60 * 1000;
    }
    interval = timeSpan / totalQuantity;

    for (let i = 0; i < totalQuantity; i++) {
        let potentialTime = new Date(now.getTime() + i * interval);
        if (intervalType === 'Random') {
            const randomOffset = (Math.random() - 0.5) * 30 * 60 * 1000;
            potentialTime.setTime(potentialTime.getTime() + randomOffset);
        }

        while (isDndActive(potentialTime)) {
            potentialTime.setTime(potentialTime.getTime() + 30 * 60 * 1000);
        }
        times.push(potentialTime);
    }
    setTriggerTimesPreview(times);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a name for the minder.');
      return;
    }

    setProgress(0);
    setIsProcessing(true);

    try {
        log.info(`Saving minder: ${name}`);

        const numQuantity = parseInt(quantity, 10) || 1;
        if (reminderFrequency === 'Daily' && numQuantity > 24) {
            Alert.alert('Error', 'Maximum daily triggers is 24.');
            setIsProcessing(false);
            return;
        }
        if (reminderFrequency === 'Weekly' && numQuantity > 100) {
            Alert.alert('Error', 'Maximum weekly triggers is 100.');
            setIsProcessing(false);
            return;
        }

        let triggerTimes = [];
        if (reminderFrequency !== 'Continuous' && intervalType === 'Equal') {
            await calculateTriggerTimesPreview(); // Use the preview calculation
            triggerTimes = triggerTimesPreview.map(t => ({ hours: t.getHours(), minutes: t.getMinutes() }));
        }

        const newMinder = {
          id: minderId || `${Date.now()}-${Math.random()}`,
          name,
          color: selectedColor,
          reminderFrequency,
          quantity: numQuantity,
          note,
          scheduleAroundDnd,
          intervalType,
          triggerTimes, // Stored for Equal intervals
          successStreak: minderId ? undefined : 0,
        };

        const storedMinders = await AsyncStorage.getItem(MINDERS_STORAGE_KEY);
        let minders = storedMinders ? JSON.parse(storedMinders) : [];
        if (minderId) {
          minders = minders.map((m: any) => m.id === minderId ? newMinder : m);
        } else {
          minders.push(newMinder);
        }

        await AsyncStorage.setItem(MINDERS_STORAGE_KEY, JSON.stringify(minders));
        log.info(`Minder saved: ${JSON.stringify(newMinder)}`);
        await scheduleNotificationsForMinder(newMinder, setProgress);

        setIsProcessing(false);

        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/(tabs)');
        }
    } catch (error) {
        setIsProcessing(false);
        log.error('Error saving minder:', error);
        Alert.alert('Error', 'An error occurred while saving the minder.');
    }
  };

  return (
    <View style={{flex: 1, backgroundColor: colors.background}}>
        <Modal
            transparent={true}
            animationType="fade"
            visible={isProcessing}
            onRequestClose={() => {}}>
            <View style={styles.modalBackground}>
                <View style={[styles.activityIndicatorWrapper, {backgroundColor: colors.card}]}>
                    <Text style={{ color: colors.text, marginBottom: 15, fontSize: 16 }}>Scheduling... {Math.round(progress * 100)}%</Text>
                    <View style={styles.progressBarContainer}>
                        <View style={[styles.progressBar, { width: `${progress * 100}%`, backgroundColor: colors.primary }]} />
                    </View>
                </View>
            </View>
        </Modal>
        <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
        <TextInput
            style={[styles.input, { color: colors.text, backgroundColor: colors.card }]}
            placeholder="Minder Name"
            placeholderTextColor={colors.text}
            value={name}
            onChangeText={setName}
        />
        <View style={styles.optionGroup}>
            <Text style={{ color: colors.text }}>Color:</Text>
            <View style={styles.colorContainer}>
            {colorsOptions.map(color => (
                <TouchableOpacity key={color} onPress={() => setSelectedColor(color)}>
                <View style={[styles.colorOption, { backgroundColor: color, borderWidth: selectedColor === color ? 2 : 0, borderColor: colors.text }]} />
                </TouchableOpacity>
            ))}
            </View>
        </View>
        <View style={styles.optionGroup}>
            <Text style={{ color: colors.text }}>Reminder Frequency:</Text>
            <View style={styles.buttonContainer}>
            {frequencyOptions.map(freq => (
                <TouchableOpacity key={freq} style={[styles.button, { backgroundColor: reminderFrequency === freq ? colors.primary : colors.card }]} onPress={() => setReminderFrequency(freq)}>
                <Text style={{ color: reminderFrequency === freq ? 'white' : colors.text }}>{freq}</Text>
                </TouchableOpacity>
            ))}
            </View>
        </View>
        {reminderFrequency !== 'Continuous' && (
            <>
                <TextInput
                    style={[styles.input, { color: colors.text, backgroundColor: colors.card, marginTop: 10 }]}
                    placeholder="Times per day/week"
                    placeholderTextColor={colors.text}
                    value={quantity}
                    onChangeText={setQuantity}
                    keyboardType="numeric"
                />
                <View style={[styles.optionGroup, {justifyContent: 'space-between'}]}>
                    <Text style={{ color: colors.text }}>Schedule around DND:</Text>
                    <Switch value={scheduleAroundDnd} onValueChange={setScheduleAroundDnd} />
                </View>
                <View style={styles.optionGroup}>
                    <Text style={{ color: colors.text }}>Interval Type:</Text>
                    <View style={styles.buttonContainer}>
                    {intervalOptions.map(type => (
                        <TouchableOpacity key={type} style={[styles.button, { backgroundColor: intervalType === type ? colors.primary : colors.card }]} onPress={() => setIntervalType(type)}>
                        <Text style={{ color: intervalType === type ? 'white' : colors.text }}>{type}</Text>
                        </TouchableOpacity>
                    ))}
                    </View>
                </View>
                <View style={styles.triggerTimesContainer}>
                    <Text style={{ color: colors.text, fontWeight: 'bold' }}>Upcoming Triggers Preview:</Text>
                    {triggerTimesPreview.map((time, index) => (
                        <Text key={index} style={{ color: colors.text }}>{time.toLocaleString()}</Text>
                    ))}
                </View>
            </>
        )}
        <TextInput
            style={[styles.input, { color: colors.text, backgroundColor: colors.card, marginTop: 10, height: 100 }]}
            placeholder="Note (optional)"
            placeholderTextColor={colors.text}
            value={note}
            onChangeText={setNote}
            multiline
        />
        <TouchableOpacity style={[styles.saveButton, { backgroundColor: colors.primary }]} onPress={handleSave}>
            <Text style={styles.saveButtonText}>Save Minder</Text>
        </TouchableOpacity>
        </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  input: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    fontSize: 16,
  },
  optionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  colorContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    flex: 1,
  },
  colorOption: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flex: 1,
    gap: 8,
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  saveButton: {
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 20,
  },
  saveButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  triggerTimesContainer: {
      marginTop: 16,
      padding: 10,
      backgroundColor: '#f0f0f0',
      borderRadius: 5,
      marginBottom: 20,
  },
  modalBackground: {
    flex: 1,
    alignItems: 'center',
    flexDirection: 'column',
    justifyContent: 'space-around',
    backgroundColor: '#00000040'
  },
  activityIndicatorWrapper: {
    padding: 25,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '70%'
  },
  progressBarContainer: {
    height: 10,
    width: '100%',
    backgroundColor: '#e0e0e0',
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 5,
  }
});