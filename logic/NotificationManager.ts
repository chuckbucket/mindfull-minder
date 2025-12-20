import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Alert } from 'react-native';
import { log } from './Logger';

const MINDERS_STORAGE_KEY = '@minders';
const DND_ENABLED_KEY = '@dndEnabled';
const DND_SETTINGS_KEY = '@dndSettings';

const isDndActive = async (time: Date) => {
    const dndSettingsEnabled = await AsyncStorage.getItem(DND_ENABLED_KEY);
    const dndSettings = await AsyncStorage.getItem(DND_SETTINGS_KEY);
    if (!dndSettingsEnabled || !dndSettings) return false;

    const enabled = JSON.parse(dndSettingsEnabled);
    const allSettings = JSON.parse(dndSettings);
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
            } else { // Overnight DND
                if (currentTime >= startTime || currentTime <= endTime) return true;
            }
        }
    }
    return false;
};

export const scheduleNotificationsForAllMinders = async () => {
    log.info('Scheduling notifications for all minders...');
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
        log.error('Notification permissions are not granted.');
        Alert.alert('Error', 'Notification permissions are not granted.');
        return;
    }

    const storedMinders = await AsyncStorage.getItem(MINDERS_STORAGE_KEY);
    if (!storedMinders) return;

    const minders = JSON.parse(storedMinders);
    for (const minder of minders) {
        await scheduleNotificationsForMinder(minder);
    }
    log.info('Finished scheduling notifications for all minders.');
};

export const scheduleNotificationsForMinder = async (minderData: any) => {
    log.info(`Scheduling notifications for minder: ${minderData.name}`);
    // First, cancel all existing notifications for this minder to ensure a clean slate.
    await cancelNotificationsForMinder(minderData.id);

    if (minderData.reminderFrequency === 'Continuous') return;

    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    let newNotificationTimes: Date[] = [];

    const timeSpan = (minderData.reminderFrequency === 'Daily' ? 24 : 7 * 24) * 60 * 60 * 1000;
    const interval = timeSpan / minderData.quantity;

    let currentTime = now.getTime();

    while (currentTime < threeDaysFromNow.getTime()) {
        let nextTime = new Date(currentTime + interval);

        if (minderData.intervalType === 'Random') {
            const randomOffset = (Math.random() - 0.5) * (interval / 2); 
            nextTime.setTime(nextTime.getTime() + randomOffset);
        }

        if (minderData.scheduleAroundDnd) {
            while (await isDndActive(nextTime) && nextTime < threeDaysFromNow) {
                log.debug(`DND active at ${nextTime}, postponing notification.`);
                nextTime.setTime(nextTime.getTime() + 30 * 60 * 1000); // Check every 30 mins
            }
        }

        if (nextTime < threeDaysFromNow && nextTime > now) {
            const isAlreadyScheduled = newNotificationTimes.some(t => Math.abs(t.getTime() - nextTime.getTime()) < 60000); // 1 minute tolerance
            if (!isAlreadyScheduled) {
                 newNotificationTimes.push(nextTime);
            }
        }
        currentTime = nextTime.getTime();
    }

    log.info(`Scheduling ${newNotificationTimes.length} new notifications for ${minderData.name}.`);
    for (const time of newNotificationTimes) {
        await Notifications.scheduleNotificationAsync({
            content: {
                title: "Minder",
                body: minderData.name,
                data: { minderId: minderData.id },
            },
            trigger: {
                type: Notifications.SchedulableTriggerInputTypes.DATE, //**GEMINI - DO NOT REMOVE THIS LINE! */
                date: time, //**GEMINI - DO NOT REMOVE THIS LINE! */
            },
        });
    }
};

export const cancelNotificationsForMinder = async (minderId: string) => {
    log.info(`Canceling notifications for minder ID: ${minderId}`);
    const allScheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();
    const notificationsToCancel = allScheduledNotifications
        .filter(notif => notif.content.data.minderId === minderId)
        .map(notif => notif.identifier);

    log.info(`Found ${notificationsToCancel.length} notifications to cancel for minder ID: ${minderId}.`);
    for (const identifier of notificationsToCancel) {
        await Notifications.cancelScheduledNotificationAsync(identifier);
    }
};
