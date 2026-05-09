import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { log } from './Logger';
import { scheduleNotificationsForAllMinders } from './NotificationManager';
import { scheduleHolidayNotifications } from './HolidayManager';

const MINDERS_STORAGE_KEY = '@minders';
const LAST_BG_REFRESH_KEY = '@last_background_refresh_at';
export const BACKGROUND_FETCH_TASK = 'MINDFULL_MINDER_BG_FETCH';
const BG_REFRESH_INTERVAL_MS = 20 * 60 * 60 * 1000; // refresh at most once every ~20h in background

const shouldRunDailyRefresh = async (): Promise<boolean> => {
    const raw = await AsyncStorage.getItem(LAST_BG_REFRESH_KEY);
    if (!raw) return true;
    const last = Number(raw);
    if (!Number.isFinite(last)) return true;
    return Date.now() - last >= BG_REFRESH_INTERVAL_MS;
};

const needsRescheduling = async (): Promise<boolean> => {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    if (scheduled.length === 0) return true;

    const storedMinders = await AsyncStorage.getItem(MINDERS_STORAGE_KEY);
    if (!storedMinders) return false;

    const minders = JSON.parse(storedMinders) as Array<{ id: string; reminderFrequency: string }>;
    const threshold = Date.now() + 24 * 60 * 60 * 1000;

    for (const minder of minders) {
        if (minder.reminderFrequency === 'Continuous') continue;
        const hasFutureNotifs = scheduled.some(
            n =>
                (n.content.data as any)?.minderId === minder.id &&
                ((n.trigger as any)?.value ?? (n.trigger as any)?.timestamp) > threshold,
        );
        if (!hasFutureNotifs) return true;
    }
    return false;
};

TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
    try {
        log.info('[BG] Background fetch task started');
        if (await shouldRunDailyRefresh()) {
            await scheduleHolidayNotifications();
            if (await needsRescheduling()) {
                log.info('[BG] Rescheduling notifications');
                await scheduleNotificationsForAllMinders();
            }
            await AsyncStorage.setItem(LAST_BG_REFRESH_KEY, String(Date.now()));
        } else {
            log.info('[BG] Skipping refresh (recently run)');
        }
        log.info('[BG] Background fetch task completed');
        return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch (error) {
        log.error('[BG] Background fetch task failed:', error);
        return BackgroundFetch.BackgroundFetchResult.Failed;
    }
});

export const registerBackgroundFetchTask = async (): Promise<void> => {
    try {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_FETCH_TASK);
        if (isRegistered) {
            log.info('[BG] Background fetch task already registered');
            return;
        }
        await BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
            minimumInterval: 24 * 60 * 60,
            stopOnTerminate: false,
            startOnBoot: true,
        });
        log.info('[BG] Background fetch task registered');
    } catch (error) {
        log.error('[BG] Failed to register background fetch task:', error);
    }
};
