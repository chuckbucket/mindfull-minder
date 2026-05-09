import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { log } from './Logger';
import { getNotificationStats } from './NotificationManager';

const HOLIDAYS_KEY = '@holidays';
const IOS_NOTIFICATION_LIMIT = 64;
const NOTIFICATION_HOUR = 9; // 9 AM local time
const MAX_LOOKAHEAD_DAYS = 45;
const FIRST_REMINDER_OFFSET = 45;
const NOTIFICATION_STATS_KEY = '@notificationStats';

export type HolidayType = 'builtin' | 'birthday' | 'anniversary' | 'custom';

export type Holiday = {
  id: string;
  name: string;
  type: HolidayType;
  month: number; // 1-12; 0 for computed dates (Mother's/Father's Day)
  day: number;   // 1-31; 0 for computed dates
  year?: number; // optional start year for ordinal calculation (birth year, anniversary year, etc.)
  enabled: boolean;
};

const BUILT_IN_HOLIDAYS: Holiday[] = [
  { id: 'valentines', name: "Valentine's Day", type: 'builtin', month: 2, day: 14, enabled: true },
  { id: 'mothersday', name: "Mother's Day", type: 'builtin', month: 5, day: 0, enabled: true },
  { id: 'fathersday', name: "Father's Day", type: 'builtin', month: 6, day: 0, enabled: true },
];

function nthSundayOfMonth(year: number, monthIndex: number, n: number): Date {
  const first = new Date(year, monthIndex, 1);
  const dayOfWeek = first.getDay(); // 0 = Sunday
  const firstSunday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  return new Date(year, monthIndex, firstSunday + (n - 1) * 7);
}

export function getEventDate(holiday: Holiday, year: number): Date {
  if (holiday.id === 'mothersday') return nthSundayOfMonth(year, 4, 2); // 2nd Sunday of May
  if (holiday.id === 'fathersday') return nthSundayOfMonth(year, 5, 3); // 3rd Sunday of June
  return new Date(year, holiday.month - 1, holiday.day);
}

export function getNextOccurrence(holiday: Holiday): Date {
  const now = new Date();
  const thisYear = getEventDate(holiday, now.getFullYear());
  if (thisYear > now) return thisYear;
  return getEventDate(holiday, now.getFullYear() + 1);
}

export async function getHolidays(): Promise<Holiday[]> {
  const raw = await AsyncStorage.getItem(HOLIDAYS_KEY);
  if (!raw) {
    await AsyncStorage.setItem(HOLIDAYS_KEY, JSON.stringify(BUILT_IN_HOLIDAYS));
    return [...BUILT_IN_HOLIDAYS];
  }
  try {
    const stored: Holiday[] = JSON.parse(raw);
    const ids = new Set(stored.map(h => h.id));
    const merged = [...stored];
    for (const builtin of BUILT_IN_HOLIDAYS) {
      if (!ids.has(builtin.id)) merged.unshift(builtin);
    }
    if (merged.length !== stored.length) {
      await AsyncStorage.setItem(HOLIDAYS_KEY, JSON.stringify(merged));
    }
    return merged;
  } catch {
    return [...BUILT_IN_HOLIDAYS];
  }
}

export async function saveHolidays(holidays: Holiday[]): Promise<void> {
  await AsyncStorage.setItem(HOLIDAYS_KEY, JSON.stringify(holidays));
}

export async function cancelHolidayNotifications(): Promise<void> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    all
      .filter(n => (n.content.data as any)?.notificationType === 'holiday')
      .map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

export function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function buildMessage(holiday: Holiday, daysRemaining: number, eventYear: number): { title: string; body: string } {
  let displayName = holiday.name;
  if (holiday.year && eventYear > holiday.year) {
    const ordinal = getOrdinal(eventYear - holiday.year);
    if (holiday.type === 'birthday') displayName = `${holiday.name}'s ${ordinal} Birthday`;
    else if (holiday.type === 'anniversary') displayName = `${holiday.name} — ${ordinal} Anniversary`;
    else displayName = `${holiday.name} (${ordinal})`;
  }
  if (daysRemaining === 0) return { title: `🎉 ${displayName} is today!`, body: 'Wishing you a wonderful day.' };
  if (daysRemaining === 1) return { title: `${displayName} is tomorrow! 🎉`, body: 'Last chance to get ready.' };
  if (daysRemaining <= 7) return { title: `${displayName} is in ${daysRemaining} days`, body: 'Getting close!' };
  if (daysRemaining === 15) return { title: `${displayName} is in 2 weeks`, body: 'A good time to start planning.' };
  if (daysRemaining === 30) return { title: `${displayName} is in 1 month`, body: 'Time to start thinking ahead 🗓' };
  return { title: `${displayName} is in ${daysRemaining} days`, body: 'Mark your calendar!' };
}

function startOfDay(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

function diffInDays(from: Date, to: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((startOfDay(to).getTime() - startOfDay(from).getTime()) / msPerDay);
}

function getStartOfWeek(d: Date): Date {
  const date = startOfDay(d);
  date.setDate(date.getDate() - date.getDay()); // Sunday start
  return date;
}

function isInCurrentWeek(target: Date, now: Date): boolean {
  const weekStart = getStartOfWeek(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const day = startOfDay(target);
  return day >= weekStart && day < weekEnd;
}

export async function scheduleHolidayNotifications(): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  log.info('Scheduling holiday notifications...');
  await cancelHolidayNotifications();

  const allScheduled = await Notifications.getAllScheduledNotificationsAsync();
  let slotsAvailable = IOS_NOTIFICATION_LIMIT - allScheduled.length;

  const holidays = await getHolidays();
  const enabledHolidays = holidays.filter(h => h.enabled);
  const now = new Date();
  let scheduledCount = 0;
  let holidaysInRange = 0;

  for (const holiday of enabledHolidays) {
    if (slotsAvailable <= 0) break;
    const eventDate = getNextOccurrence(holiday);
    const daysUntilEvent = diffInDays(now, eventDate);

    // Only schedule holidays that occur in the next 45 days.
    if (daysUntilEvent < 0 || daysUntilEvent > MAX_LOOKAHEAD_DAYS) continue;
    holidaysInRange++;

    const candidateOffsets = new Set<number>();
    candidateOffsets.add(0); // Holiday day
    if (daysUntilEvent >= FIRST_REMINDER_OFFSET) {
      candidateOffsets.add(FIRST_REMINDER_OFFSET); // First reminder
    }
    for (let days = 1; days <= 7; days++) {
      const reminderDate = new Date(eventDate);
      reminderDate.setDate(reminderDate.getDate() - days);
      if (isInCurrentWeek(reminderDate, now)) {
        candidateOffsets.add(days); // Current-week reminder
      }
    }

    for (const daysRemaining of Array.from(candidateOffsets).sort((a, b) => b - a)) {
      if (slotsAvailable <= 0) break;

      const reminderDate = new Date(eventDate);
      reminderDate.setDate(reminderDate.getDate() - daysRemaining);
      reminderDate.setHours(NOTIFICATION_HOUR, 0, 0, 0);

      if (reminderDate <= now) continue;

      const { title, body } = buildMessage(holiday, daysRemaining, eventDate.getFullYear());
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title,
            body,
            data: { notificationType: 'holiday', holidayId: holiday.id, daysRemaining },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: reminderDate,
          },
        });
        scheduledCount++;
        slotsAvailable--;
      } catch (err) {
        log.error(`Failed to schedule holiday notification for ${holiday.name} -${daysRemaining}d:`, err);
      }
    }
  }

  const existingStats = await getNotificationStats();
  await AsyncStorage.setItem(
    NOTIFICATION_STATS_KEY,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      minderRun: existingStats?.minderRun,
      holidayRun: {
        holidaysEnabled: enabledHolidays.length,
        holidaysInRange,
        scheduled: scheduledCount,
        availableSlotsAtStart: IOS_NOTIFICATION_LIMIT - allScheduled.length,
      },
    }),
  );

  log.info(`Scheduled ${scheduledCount} holiday notifications.`);
}
