import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { initializeLogging, logAppStartup } from '../../logic/Logger';
import { version } from '../../package.json';

export default function TabLayout() {
  const { colors } = useTheme();

  useEffect(() => {
    const startup = async () => {
      await initializeLogging();
      await logAppStartup(version);
    }
    startup();
  }, []);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.text,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
        },
        headerStyle: {
          backgroundColor: colors.card,
        },
        headerTintColor: colors.text,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Minders',
          tabBarIcon: ({ color, size }) => <Ionicons name="list" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
