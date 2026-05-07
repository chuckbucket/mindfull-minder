import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ThemeProvider } from '../context/ThemeContext';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { addMinderEvent, getAllMinderEvents } from '../logic/MinderEvents';
import '../logic/BackgroundTaskManager';
import { registerBackgroundFetchTask } from '../logic/BackgroundTaskManager';
import { scheduleHolidayNotifications } from '../logic/HolidayManager';

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

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  // Splash is hidden by RootLayoutNav after the onboarding check completes,
  // so there is no flash of the home screen before the redirect fires.
  if (!loaded) {
    return null;
  }

  return (
    <ErrorBoundary>
      <RootLayoutNav />
    </ErrorBoundary>
  );
}

function RootLayoutNav() {
  const router = useRouter();

  useEffect(() => {
    // Check onboarding before hiding the splash screen to prevent a flash of the home screen.
    const checkOnboarding = async () => {
      try {
        const value = await AsyncStorage.getItem('@hasSeenOnboarding');
        if (!value) {
          router.replace('/onboarding');
        }
      } finally {
        SplashScreen.hideAsync();
      }
    };
    void checkOnboarding();

    void Notifications.setNotificationCategoryAsync('MINDER_REMINDER', [
      {
        identifier: 'COMPLETE',
        buttonTitle: 'Mark Complete',
        options: { opensAppToForeground: false },
      },
      {
        identifier: 'LOG',
        buttonTitle: 'Add Log',
        options: { opensAppToForeground: true },
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
      const at = Date.now();

      if (response.actionIdentifier === 'COMPLETE') {
        const id = `completed:${minderId}:${typeof triggerAt === 'number' && !Number.isNaN(triggerAt) ? triggerAt : at}`;
        void addMinderEvent({ id, minderId, kind: 'completed', at, triggerAt });
        void Notifications.dismissNotificationAsync(response.notification.request.identifier);
        return;
      }

      if (response.actionIdentifier === 'LOG') {
        void Notifications.dismissNotificationAsync(response.notification.request.identifier);
        router.push({
          pathname: '/(tabs)',
          params: {
            openLogFor: minderId,
            logTriggerAt: String(triggerAt ?? ''),
          },
        });
        return;
      }

      const id = `opened:${minderId}:${typeof triggerAt === 'number' && !Number.isNaN(triggerAt) ? triggerAt : at}`;
      void addMinderEvent({ id, minderId, kind: 'triggered', at, triggerAt });
    });

    void registerBackgroundFetchTask();
    void scheduleHolidayNotifications();

    // Dismiss sticky minder notifications > 30 min past their trigger and log as missed
    void (async () => {
      const presented = await Notifications.getPresentedNotificationsAsync();
      const allEvents = await getAllMinderEvents();
      const now = Date.now();
      const TWO_HOURS = 2 * 60 * 60 * 1000;
      for (const notification of presented) {
        const mid = (notification.request.content.data as any)?.minderId;
        if (typeof mid !== 'string') continue;
        const triggerDateValue = (notification.request.trigger as any)?.date;
        const triggerAt = triggerDateValue ? new Date(triggerDateValue).getTime() : undefined;
        if (typeof triggerAt !== 'number' || Number.isNaN(triggerAt)) continue;
        if (now - triggerAt > 30 * 60 * 1000) {
          void Notifications.dismissNotificationAsync(notification.request.identifier);
          const handled = allEvents.some(
            e =>
              e.minderId === mid &&
              (e.kind === 'log' || e.kind === 'note' || e.kind === 'completed') &&
              Math.abs(e.at - triggerAt) <= TWO_HOURS,
          );
          if (!handled) {
            const id = `missed:${mid}:${triggerAt}`;
            void addMinderEvent({ id, minderId: mid, kind: 'missed', at: now, triggerAt });
          }
        }
      }
    })();

    return () => {
      onReceived.remove();
      onResponse.remove();
    };
  }, []);

  return (
    <ThemeProvider>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        <Stack.Screen name="create-minder" options={{ title: 'Create Minder' }} />
        <Stack.Screen name="holidays" options={{ title: 'Holiday Reminders' }} />
      </Stack>
    </ThemeProvider>
  );
}
