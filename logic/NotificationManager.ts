import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { log } from './Logger';
import { isWithinTimeWindow, moveDateIntoTimeWindow, parseClockTimeToMinutes } from './TimeWindow';

const MINDERS_STORAGE_KEY = '@minders';
const DND_ENABLED_KEY = '@dndEnabled';
const DND_SETTINGS_KEY = '@dndSettings';
const IOS_NOTIFICATION_LIMIT = 64;

// Helper to check if a given time falls within a DND period
const isDndActive = async (time: Date) => {
    const dndEnabled = await AsyncStorage.getItem(DND_ENABLED_KEY);
    if (!dndEnabled || dndEnabled !== 'true') return false;

    const dndSettings = await AsyncStorage.getItem(DND_SETTINGS_KEY);
    if (!dndSettings) return false;

    const allSettings = JSON.parse(dndSettings);
    const enabledSettings = await AsyncStorage.getItem(DND_ENABLED_KEY);
    const enabled = enabledSettings ? JSON.parse(enabledSettings) : {};

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
            } else { // Overnight case
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

export const scheduleNotificationsForMinder = async (minderData: any, onProgress?: (progress: number) => void) => {
    log.info(`Scheduling notifications for minder: ${minderData.name}`);
    await cancelNotificationsForMinder(minderData.id);

    if (minderData.reminderFrequency === 'Continuous') {
        onProgress?.(1);
        return;
    }

    const allScheduled = await Notifications.getAllScheduledNotificationsAsync();
    const otherMindersNotifications = allScheduled.filter(n => n.content.data.minderId !== minderData.id);
    const slotsUsed = otherMindersNotifications.length;
    const availableSlots = IOS_NOTIFICATION_LIMIT - slotsUsed;

    if (availableSlots <= 0) {
        log.warn('No available notification slots.');
        onProgress?.(1);
        return;
    }

    const now = new Date();
    const scheduleUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // Schedule up to 7 days
    let newNotificationTimes: Date[] = [];

    const timeSpan = (minderData.reminderFrequency === 'Daily' ? 24 : 7 * 24) * 60 * 60 * 1000;
    const interval = timeSpan / minderData.quantity;

    const startMinutes = typeof minderData.notificationStartTime === 'string' ? parseClockTimeToMinutes(minderData.notificationStartTime) : null;
    const endMinutes = typeof minderData.notificationEndTime === 'string' ? parseClockTimeToMinutes(minderData.notificationEndTime) : null;
    const hasWindow = startMinutes !== null && endMinutes !== null && startMinutes !== endMinutes;

    let currentTime = now.getTime();

    while (currentTime < scheduleUntil.getTime() && newNotificationTimes.length < availableSlots) {
        let nextTime = new Date(currentTime + interval);

        if (minderData.intervalType === 'Random') {
            const randomOffset = (Math.random() - 0.5) * (interval / 2);
            nextTime.setTime(nextTime.getTime() + randomOffset);
        }

        if (hasWindow && startMinutes !== null && endMinutes !== null) {
            nextTime = moveDateIntoTimeWindow(nextTime, startMinutes, endMinutes);
        }

        while (nextTime < scheduleUntil) {
            if (hasWindow && startMinutes !== null && endMinutes !== null && !isWithinTimeWindow(nextTime, startMinutes, endMinutes)) {
                nextTime = moveDateIntoTimeWindow(nextTime, startMinutes, endMinutes);
                continue;
            }

            if (minderData.scheduleAroundDnd && (await isDndActive(nextTime))) {
                log.debug(`DND active at ${nextTime}, postponing notification.`);
                nextTime.setTime(nextTime.getTime() + 30 * 60 * 1000);
                if (hasWindow && startMinutes !== null && endMinutes !== null) {
                    nextTime = moveDateIntoTimeWindow(nextTime, startMinutes, endMinutes);
                }
                continue;
            }

            break;
        }

        if (nextTime < scheduleUntil && nextTime > now) {
            const isAlreadyScheduled = newNotificationTimes.some(t => Math.abs(t.getTime() - nextTime.getTime()) < 60000); // 1 minute tolerance
            if (!isAlreadyScheduled) {
                newNotificationTimes.push(nextTime);
            }
        }
        currentTime = nextTime.getTime();
    }

    log.info(`Calculated ${newNotificationTimes.length} notification times. ${availableSlots} slots were available.`);

    let scheduledCount = 0;
    const totalToSchedule = newNotificationTimes.length;

    for (const nextTime of newNotificationTimes) {
        try {
            await Notifications.scheduleNotificationAsync({
                content: {
                    title: minderData.name,
                    body: 'Reminder',
                    data: { minderId: minderData.id, minderName: minderData.name },
                    categoryIdentifier: 'MINDER_REMINDER',
                },
                trigger: {
                    type: Notifications.SchedulableTriggerInputTypes.DATE,
                    date: nextTime,
                },
            });
            scheduledCount++;
            if (onProgress) {
                onProgress(scheduledCount / totalToSchedule);
            }
        } catch (error) {
            log.error(`Error scheduling notification for ${minderData.name} at ${nextTime}:`, error);
        }
    }

    // Ensure progress reaches 100% even if there are no notifications
    onProgress?.(1);
};

export const cancelNotificationsForMinder = async (minderId: string) => {
    log.info(`Cancelling notifications for minder ID: ${minderId}`);
    const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();
    for (const notification of scheduledNotifications) {
        if (notification.content.data.minderId === minderId) {
            await Notifications.cancelScheduledNotificationAsync(notification.identifier);
        }
    }
};
