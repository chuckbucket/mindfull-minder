import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

const MINDERS_STORAGE_KEY = '@minders';

export const scheduleNotificationsForAllMinders = async () => {
    const Notifications = await import('expo-notifications');
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
        Alert.alert('Error', 'Failed to get push token for push notification!');
        return;
    }

    const storedMinders = await AsyncStorage.getItem(MINDERS_STORAGE_KEY);
    if (!storedMinders) return;

    const minders = JSON.parse(storedMinders);
    const allScheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();

    for (const minder of minders) {
        if (minder.reminderFrequency === 'Continuous') continue;

        const scheduledForMinder = allScheduledNotifications.filter(
            (notif) => notif.content.data.minderId === minder.id
        );

        if (scheduledForMinder.length < 7) {
            await scheduleNotificationsForMinder(minder);
        }
    }
};

export const scheduleNotificationsForMinder = async (minderData: any) => {
    const Notifications = await import('expo-notifications');
    const now = new Date();
    const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    let notificationTimes: Date[] = [];

    const allScheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();
    for (const notif of allScheduledNotifications) {
        if (notif.content.data.minderId === minderData.id) {
            await Notifications.cancelNotificationAsync(notif.identifier);
        }
    }

    switch (minderData.reminderFrequency) {
        case 'Daily':
            for (let i = 0; i < 7; i++) {
                const date = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
                date.setHours(9, 0, 0, 0);
                if (date > now) notificationTimes.push(date);
            }
            break;
        case 'Weekly':
            const weeklyDate = new Date(now.getTime());
            weeklyDate.setHours(9, 0, 0, 0);
            if (weeklyDate > now) {
                notificationTimes.push(weeklyDate);
            } else {
                const nextWeekDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                nextWeekDate.setHours(9, 0, 0, 0);
                notificationTimes.push(nextWeekDate);
            }
            break;
        case 'X per day':
        case 'X per week':
            const isPerDay = minderData.reminderFrequency === 'X per day';
            const totalQuantity = parseInt(minderData.quantity, 10);

            if (!totalQuantity || totalQuantity <= 0) {
                console.warn(`Invalid quantity "${minderData.quantity}" for minder "${minderData.name}". No notifications will be scheduled.`);
                break;
            }

            const interval = isPerDay ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;

            if (minderData.distribution === 'Equally Spread') {
                const spacing = interval / totalQuantity;
                const loopCount = isPerDay ? totalQuantity * 7 : totalQuantity;
                for (let i = 0; i < loopCount; i++) {
                    const time = new Date(now.getTime() + (i % totalQuantity) * spacing + Math.floor(i / totalQuantity) * (isPerDay ? 24 * 60 * 60 * 1000 : 0));
                    if (time > now) notificationTimes.push(time);
                }
            } else { // Random
                let attempts = 0;
                const loopCount = isPerDay ? totalQuantity * 7 : totalQuantity;
                while (notificationTimes.length < loopCount && attempts < 1000) {
                    const randomTime = new Date(now.getTime() + Math.random() * interval);
                    if (randomTime > now) {
                        const isTooClose = notificationTimes.some(time => Math.abs(time.getTime() - randomTime.getTime()) < 60 * 60 * 1000);
                        if (!isTooClose) {
                            notificationTimes.push(randomTime);
                        }
                    }
                    attempts++;
                }
            }
            break;
    }

    for (const time of notificationTimes) {
        if (time < oneWeekFromNow) {
            await Notifications.scheduleNotificationAsync({
                content: {
                    title: "Minder",
                    body: minderData.name,
                    data: { minderId: minderData.id },
                },
                trigger: time,
            });
        }
    }
};

export const cancelNotificationsForMinder = async (minderId: string) => {
    const Notifications = await import('expo-notifications');
    const allScheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();
    for (const notif of allScheduledNotifications) {
        if (notif.content.data.minderId === minderId) {
            await Notifications.cancelNotificationAsync(notif.identifier);
        }
    }
};
