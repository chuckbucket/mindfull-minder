import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ThemeProvider } from '../context/ThemeContext';
import * as Notifications from 'expo-notifications';
import { addMinderEvent } from '../logic/MinderEvents';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `(app)/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  useEffect(() => {
    void Notifications.setNotificationCategoryAsync('MINDER_REMINDER', [
      {
        identifier: 'SNOOZE_15_MIN',
        buttonTitle: 'Snooze 15m',
        options: { opensAppToForeground: false },
      },
    ]);

    const onReceived = Notifications.addNotificationReceivedListener(notification => {
      const minderId = (notification.request.content.data as any)?.minderId;
      if (typeof minderId !== 'string') return;
      const triggerDateValue = (notification.request.trigger as any)?.date;
      const triggerAt = triggerDateValue ? new Date(triggerDateValue).getTime() : undefined;
      const at = Date.now();
      const id = `triggered:${minderId}:${typeof triggerAt === 'number' && !Number.isNaN(triggerAt) ? triggerAt : at}`;
      void addMinderEvent({ id, minderId, kind: 'triggered', at, triggerAt });
    });

    const onResponse = Notifications.addNotificationResponseReceivedListener(response => {
      const minderId = (response.notification.request.content.data as any)?.minderId;
      if (typeof minderId !== 'string') return;

      const triggerDateValue = (response.notification.request.trigger as any)?.date;
      const triggerAt = triggerDateValue ? new Date(triggerDateValue).getTime() : undefined;
      const minderName = (response.notification.request.content.data as any)?.minderName;
      const at = Date.now();

      if (response.actionIdentifier === 'SNOOZE_15_MIN') {
        const snoozeAt = new Date(Date.now() + 15 * 60 * 1000);
        void Notifications.scheduleNotificationAsync({
          content: {
            title: typeof minderName === 'string' ? minderName : 'Minder',
            body: 'Reminder (Snoozed)',
            data: { minderId, minderName: typeof minderName === 'string' ? minderName : undefined, snoozedFromTriggerAt: triggerAt },
            categoryIdentifier: 'MINDER_REMINDER',
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: snoozeAt,
          },
        });
        return;
      }

      const id = `opened:${minderId}:${typeof triggerAt === 'number' && !Number.isNaN(triggerAt) ? triggerAt : at}`;
      void addMinderEvent({ id, minderId, kind: 'triggered', at, triggerAt });
    });

    return () => {
      onReceived.remove();
      onResponse.remove();
    };
  }, []);

  return (
    <ThemeProvider>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        <Stack.Screen name="create-minder" options={{ title: 'Create Minder' }} />
      </Stack>
    </ThemeProvider>
  );
}
