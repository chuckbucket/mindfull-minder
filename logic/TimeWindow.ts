const TIME_RE = /^([01]\\d|2[0-3]):([0-5]\\d)$/;

export const parseClockTimeToMinutes = (time: string): number | null => {
  const match = TIME_RE.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
};

const setDateToMinutes = (base: Date, minutesSinceMidnight: number) => {
  const next = new Date(base);
  next.setHours(Math.floor(minutesSinceMidnight / 60), minutesSinceMidnight % 60, 0, 0);
  return next;
};

const addDays = (base: Date, days: number) => {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
};

export const isWithinTimeWindow = (time: Date, startMinutes: number, endMinutes: number) => {
  if (startMinutes === endMinutes) return true; // Treat as "no restriction"
  const minutes = time.getHours() * 60 + time.getMinutes();
  if (startMinutes < endMinutes) {
    return minutes >= startMinutes && minutes <= endMinutes;
  }
  // Overnight window (e.g., 20:00 -> 08:00)
  return minutes >= startMinutes || minutes <= endMinutes;
};

// Moves a date forward (or keeps it) so it falls within the window.
export const moveDateIntoTimeWindow = (time: Date, startMinutes: number, endMinutes: number) => {
  if (startMinutes === endMinutes) return time; // Treat as "no restriction"
  const minutes = time.getHours() * 60 + time.getMinutes();

  if (startMinutes < endMinutes) {
    if (minutes < startMinutes) return setDateToMinutes(time, startMinutes);
    if (minutes > endMinutes) return setDateToMinutes(addDays(time, 1), startMinutes);
    return time;
  }

  // Overnight: only disallowed times are between end and start.
  if (minutes > endMinutes && minutes < startMinutes) {
    return setDateToMinutes(time, startMinutes);
  }
  return time;
};

