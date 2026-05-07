import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, AppState } from 'react-native';
import { log } from './Logger';
import { isWithinTimeWindow, moveDateIntoTimeWindow, parseClockTimeToMinutes } from './TimeWindow';

const MINDERS_STORAGE_KEY = '@minders';
const IOS_NOTIFICATION_LIMIT = 64;

export const scheduleNotificationsForAllMinders = async () => {
    log.info('Scheduling notifications for all minders...');
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
        log.error('Notification permissions are not granted.');
        if (AppState.currentState === 'active') {
            Alert.alert('Error', 'Notification permissions are not granted.');
        }
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

export const scheduleNotificationsForMinder = async (
    minderData: any,
    onProgress?: (progress: number) => void,
): Promise<{ scheduled: number; planned: number }> => {
    log.info(`Scheduling notifications for minder: ${minderData.name}`);
    await cancelNotificationsForMinder(minderData.id);

    if (minderData.paused || minderData.reminderFrequency === 'Continuous') {
        onProgress?.(1);
        return { scheduled: 0, planned: 0 };
    }

    const allScheduled = await Notifications.getAllScheduledNotificationsAsync();
    const otherMindersNotifications = allScheduled.filter(n => n.content.data.minderId !== minderData.id);
    const slotsUsed = otherMindersNotifications.length;
    const availableSlots = IOS_NOTIFICATION_LIMIT - slotsUsed;

    if (availableSlots <= 0) {
        log.warn('No available notification slots.');
        onProgress?.(1);
        return { scheduled: 0, planned: 0 };
    }

    const now = new Date();
    const scheduleUntil = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3-day rolling window; background task keeps it fresh
    let newNotificationTimes: Date[] = [];

    const timeSpan = (minderData.reminderFrequency === 'Daily' ? 24 : 7 * 24) * 60 * 60 * 1000;
    const interval = timeSpan / minderData.quantity;

    const startMinutes = typeof minderData.notificationStartTime === 'string' ? parseClockTimeToMinutes(minderData.notificationStartTime) : null;
    const endMinutes = typeof minderData.notificationEndTime === 'string' ? parseClockTimeToMinutes(minderData.notificationEndTime) : null;
    const hasWindow = startMinutes !== null && endMinutes !== null && startMinutes !== endMinutes;
    const parsedWeekdays = Array.isArray(minderData.selectedWeekdays)
        ? minderData.selectedWeekdays.filter((d: unknown): d is number => Number.isInteger(d) && d >= 0 && d <= 6)
        : [];
    const activeWeekdays = parsedWeekdays.length > 0 ? parsedWeekdays : [0, 1, 2, 3, 4, 5, 6];

    if (minderData.reminderFrequency === 'Daily' && hasWindow && startMinutes !== null && endMinutes !== null) {
        const windowMs = endMinutes > startMinutes
            ? (endMinutes - startMinutes) * 60 * 1000
            : (24 * 60 - startMinutes + endMinutes) * 60 * 1000;
        const spacing = minderData.quantity > 1 ? windowMs / (minderData.quantity - 1) : 0;

        const todayWindowStart = new Date(now);
        todayWindowStart.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);

        for (let day = 0; newNotificationTimes.length < availableSlots; day++) {
            const dayWindowStart = new Date(todayWindowStart.getTime() + day * 24 * 60 * 60 * 1000);
            if (dayWindowStart >= scheduleUntil) break;
            if (!activeWeekdays.includes(dayWindowStart.getDay())) continue;

            for (let i = 0; i < minderData.quantity && newNotificationTimes.length < availableSlots; i++) {
                let t: Date;
                if (minderData.intervalType === 'Random') {
                    if (minderData.quantity === 1) {
                        const randomMsInWindow = Math.random() * windowMs;
                        t = moveDateIntoTimeWindow(new Date(dayWindowStart.getTime() + randomMsInWindow), startMinutes, endMinutes);
                    } else {
                        const randomOffset = (Math.random() - 0.5) * spacing;
                        t = moveDateIntoTimeWindow(new Date(dayWindowStart.getTime() + i * spacing + randomOffset), startMinutes, endMinutes);
                    }
                } else {
                    t = new Date(dayWindowStart.getTime() + i * spacing);
                }
                if (t > now && t < scheduleUntil) {
                    const isAlreadyScheduled = newNotificationTimes.some(existing => Math.abs(existing.getTime() - t.getTime()) < 60000);
                    if (!isAlreadyScheduled) {
                        newNotificationTimes.push(t);
                    }
                }
            }
        }
    } else {
        let currentTime = now.getTime();
        while (currentTime < scheduleUntil.getTime() && newNotificationTimes.length < availableSlots) {
            let nextTime = new Date(currentTime + interval);

            if (minderData.intervalType === 'Random') {
                const randomOffset = (Math.random() - 0.5) * 0.6 * interval;
                nextTime.setTime(nextTime.getTime() + randomOffset);
            }

            if (hasWindow && startMinutes !== null && endMinutes !== null && !isWithinTimeWindow(nextTime, startMinutes, endMinutes)) {
                nextTime = moveDateIntoTimeWindow(nextTime, startMinutes, endMinutes);
            }

            if (nextTime < scheduleUntil && nextTime > now) {
                const isAlreadyScheduled = newNotificationTimes.some(t => Math.abs(t.getTime() - nextTime.getTime()) < 60000);
                if (!isAlreadyScheduled) {
                    newNotificationTimes.push(nextTime);
                }
            }
            currentTime = nextTime.getTime();
        }
    }

    // Enforce global quiet hours
    const quietHoursRaw = await AsyncStorage.getItem('@quietHours');
    if (quietHoursRaw) {
        try {
            const qh = JSON.parse(quietHoursRaw);
            if (qh?.enabled && typeof qh.start === 'string' && typeof qh.end === 'string') {
                const qStartMin = parseClockTimeToMinutes(qh.start);
                const qEndMin = parseClockTimeToMinutes(qh.end);
                if (qStartMin !== null && qEndMin !== null && qStartMin !== qEndMin) {
                    newNotificationTimes = newNotificationTimes.filter(t => !isWithinTimeWindow(t, qStartMin!, qEndMin!));
                }
            }
        } catch {
            // ignore malformed quiet hours
        }
    }

    log.info(`Calculated ${newNotificationTimes.length} notification times. ${availableSlots} slots were available.`);

    let scheduledCount = 0;
    const totalToSchedule = newNotificationTimes.length;

    for (const nextTime of newNotificationTimes) {
        try {
            await Notifications.scheduleNotificationAsync({
                content: {
                    title: minderData.name,
                    body: minderData.note?.trim() || 'Reminder',
                    data: { minderId: minderData.id, minderName: minderData.name },
                    categoryIdentifier: 'MINDER_REMINDER',
                    sticky: true,
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
    return { scheduled: scheduledCount, planned: newNotificationTimes.length };
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
