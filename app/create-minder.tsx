import { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert, ScrollView, Modal } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { scheduleNotificationsForMinder } from '../logic/NotificationManager';
import { log } from '../logic/Logger';
import { isWithinTimeWindow, moveDateIntoTimeWindow, parseClockTimeToMinutes } from '../logic/TimeWindow';
import 'react-native-get-random-values';

const MINDERS_STORAGE_KEY = '@minders';

const colorsOptions = ['#FF6B6B', '#FFD166', '#06D6A0', '#118AB2', '#073B4C'];
const frequencyOptions = ['Continuous', 'Daily', 'Weekly'];
const intervalOptions = ['Equal', 'Random'];

const buildTimeOptions = () => {
  const options: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    options.push(`${hh}:${mm}`);
  }
  return options;
};

const formatTimeLabel = (hhmm: string) => {
  const parsed = parseClockTimeToMinutes(hhmm);
  if (parsed === null) return hhmm;
  const hours24 = Math.floor(parsed / 60);
  const minutes = parsed % 60;
  const suffix = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = ((hours24 + 11) % 12) + 1;
  return `${hours12}:${String(minutes).padStart(2, '0')} ${suffix}`;
};

export default function CreateMinderScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const [minderId, setMinderId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState(colorsOptions[0]);
  const [reminderFrequency, setReminderFrequency] = useState(frequencyOptions[1]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [intervalType, setIntervalType] = useState(intervalOptions[0]);
  const [triggerTimesPreview, setTriggerTimesPreview] = useState<Date[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notificationStartTime, setNotificationStartTime] = useState('08:00');
  const [notificationEndTime, setNotificationEndTime] = useState('20:00');
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [timePickerTarget, setTimePickerTarget] = useState<'start' | 'end'>('start');

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
        setQuantity(typeof minderToEdit.quantity === 'number' ? minderToEdit.quantity : Number(minderToEdit.quantity) || 1);
        setNote(minderToEdit.note || '');
        setIntervalType(minderToEdit.intervalType || intervalOptions[0]);
        setNotificationStartTime(minderToEdit.notificationStartTime || '08:00');
        setNotificationEndTime(minderToEdit.notificationEndTime || '20:00');
      }
    }
  };

  const calculateTriggerTimesPreview = useCallback(async () => {
    const now = new Date();
    const times: Date[] = [];
    const totalQuantity = quantity || 1;

    const startMinutes = parseClockTimeToMinutes(notificationStartTime);
    const endMinutes = parseClockTimeToMinutes(notificationEndTime);
    const hasWindow = startMinutes !== null && endMinutes !== null && startMinutes !== endMinutes;

    if (reminderFrequency === 'Daily' && hasWindow && startMinutes !== null && endMinutes !== null) {
        const windowMs = endMinutes > startMinutes
            ? (endMinutes - startMinutes) * 60 * 1000
            : (24 * 60 - startMinutes + endMinutes) * 60 * 1000;
        const spacing = totalQuantity > 1 ? windowMs / (totalQuantity - 1) : 0;

        const todayWindowStart = new Date(now);
        todayWindowStart.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);

        for (let day = 0; times.length < totalQuantity && day <= 14; day++) {
            const dayWindowStart = new Date(todayWindowStart.getTime() + day * 24 * 60 * 60 * 1000);
            for (let i = 0; i < totalQuantity; i++) {
                let t: Date;
                if (intervalType === 'Random') {
                    const randomOffset = (Math.random() - 0.5) * spacing * 0.6;
                    t = moveDateIntoTimeWindow(new Date(dayWindowStart.getTime() + i * spacing + randomOffset), startMinutes, endMinutes);
                } else {
                    t = new Date(dayWindowStart.getTime() + i * spacing);
                }
                if (t > now) times.push(t);
                if (times.length >= totalQuantity) break;
            }
        }
    } else {
        const timeSpan = reminderFrequency === 'Daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
        const interval = timeSpan / totalQuantity;
        for (let i = 0; i < totalQuantity; i++) {
            let potentialTime = new Date(now.getTime() + (i + 1) * interval);
            if (intervalType === 'Random') {
                const randomOffset = (Math.random() - 0.5) * 0.6 * interval;
                potentialTime.setTime(potentialTime.getTime() + randomOffset);
            }
            if (hasWindow && startMinutes !== null && endMinutes !== null) {
                potentialTime = moveDateIntoTimeWindow(potentialTime, startMinutes, endMinutes);
            }
            times.push(potentialTime);
        }
    }

    setTriggerTimesPreview(times);
    return times;
  }, [intervalType, notificationEndTime, notificationStartTime, quantity, reminderFrequency]);

  useEffect(() => {
    if (reminderFrequency !== 'Continuous') {
      void calculateTriggerTimesPreview();
    }
  }, [calculateTriggerTimesPreview, reminderFrequency]);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a name for the minder.');
      return;
    }

    setProgress(0);
    setIsProcessing(true);

    try {
        log.info(`Saving minder: ${name}`);

        const numQuantity = quantity || 1;
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

        let triggerTimes: { hours: number; minutes: number }[] = [];
        if (reminderFrequency !== 'Continuous' && intervalType === 'Equal') {
            const computed = await calculateTriggerTimesPreview(); // Use the preview calculation
            triggerTimes = computed.map(t => ({ hours: t.getHours(), minutes: t.getMinutes() }));
        }

        const newMinder = {
          id: minderId || `${Date.now()}-${Math.random()}`,
          name,
          color: selectedColor,
          reminderFrequency,
          quantity: numQuantity,
          note,
          intervalType,
          triggerTimes, // Stored for Equal intervals
          notificationStartTime,
          notificationEndTime,
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
                <View style={[styles.optionGroup, { justifyContent: 'space-between' }]}>
                  <Text style={{ color: colors.text }}>Times per {reminderFrequency === 'Daily' ? 'day' : 'week'}:</Text>
                  <View style={styles.sliderContainer}>
                    {[1, 2, 3, 4, 5].map(v => (
                      <TouchableOpacity
                        key={v}
                        onPress={() => setQuantity(v)}
                        style={[
                          styles.sliderStep,
                          {
                            backgroundColor: quantity === v ? colors.primary : colors.card,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text style={{ color: quantity === v ? 'white' : colors.text, fontWeight: '600' }}>{v}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={[styles.optionGroup, { justifyContent: 'space-between' }]}>
                  <Text style={{ color: colors.text }}>Notification window:</Text>
                  <View style={styles.timeWindowContainer}>
                    <TouchableOpacity
                      style={[styles.timeButton, { backgroundColor: colors.card, borderColor: colors.border }]}
                      onPress={() => {
                        setTimePickerTarget('start');
                        setTimePickerVisible(true);
                      }}
                    >
                      <Text style={{ color: colors.text }}>{formatTimeLabel(notificationStartTime)}</Text>
                    </TouchableOpacity>
                    <Text style={{ color: colors.text, paddingHorizontal: 8 }}>to</Text>
                    <TouchableOpacity
                      style={[styles.timeButton, { backgroundColor: colors.card, borderColor: colors.border }]}
                      onPress={() => {
                        setTimePickerTarget('end');
                        setTimePickerVisible(true);
                      }}
                    >
                      <Text style={{ color: colors.text }}>{formatTimeLabel(notificationEndTime)}</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={[styles.triggerTimesContainer, { backgroundColor: colors.card }]}>
                    <Text style={{ color: colors.text, fontWeight: 'bold' }}>Upcoming Triggers Preview:</Text>
                    {triggerTimesPreview.map((time, index) => (
                        <Text key={index} style={{ color: colors.text }}>{time.toLocaleString()}</Text>
                    ))}
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

        <Modal
          transparent
          animationType="fade"
          visible={timePickerVisible}
          onRequestClose={() => setTimePickerVisible(false)}
        >
          <View style={styles.modalBackground}>
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setTimePickerVisible(false)}
            />
            <View style={[styles.timePickerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: 12 }}>
                Select {timePickerTarget === 'start' ? 'Start' : 'End'} Time
              </Text>
              <ScrollView style={{ maxHeight: 320 }}>
                {buildTimeOptions().map(option => (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.timeOption,
                      {
                        backgroundColor:
                          (timePickerTarget === 'start' ? notificationStartTime : notificationEndTime) === option
                            ? colors.primary
                            : 'transparent',
                      },
                    ]}
                    onPress={() => {
                      if (timePickerTarget === 'start') setNotificationStartTime(option);
                      else setNotificationEndTime(option);
                      setTimePickerVisible(false);
                    }}
                  >
                    <Text
                      style={{
                        color:
                          (timePickerTarget === 'start' ? notificationStartTime : notificationEndTime) === option
                            ? 'white'
                            : colors.text,
                        paddingVertical: 10,
                      }}
                    >
                      {formatTimeLabel(option)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
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
  sliderContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  sliderStep: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 36,
    alignItems: 'center',
  },
  timeWindowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  timePickerCard: {
    width: '80%',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  timeOption: {
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 6,
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
