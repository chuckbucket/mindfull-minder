import { useState, useEffect } from 'react';
import { View, Text, Switch, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { setLogLevel, getLogs } from '../../logic/Logger';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LOG_LEVEL_KEY = '@logLevel';

export default function SettingsScreen() {
  const { colors, isDarkMode, setScheme } = useTheme();
  const [logLevel, setLogLevelState] = useState('info');

  useEffect(() => {
    const fetchLogLevel = async () => {
      const storedLevel = await AsyncStorage.getItem(LOG_LEVEL_KEY) as 'debug' | 'info' | 'warn' | 'error' | null;
      if (storedLevel) {
        setLogLevelState(storedLevel);
      }
    };
    fetchLogLevel();
  }, []);

  const handleLogLevelChange = (level: 'debug' | 'info' | 'warn' | 'error') => {
    setLogLevel(level);
    setLogLevelState(level);
  };

  const viewLogs = async () => {
      const logs = await getLogs();
      Alert.alert('App Logs', logs, [{ text: 'Close' }], { cancelable: true });
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.settingRow}>
        <Text style={[styles.settingLabel, { color: colors.text }]}>Dark Mode</Text>
        <Switch value={isDarkMode} onValueChange={(value) => setScheme(value ? 'dark' : 'light')} />
      </View>
      <View style={styles.settingRow}>
        <Text style={[styles.settingLabel, { color: colors.text }]}>Log Level</Text>
        <View style={styles.logLevelContainer}>
          {('debug' as const, ['info', 'warn', 'error']).map((level) => (
            <TouchableOpacity
              key={level}
              style={[
                styles.logLevelButton,
                { backgroundColor: logLevel === level ? colors.primary : colors.card },
              ]}
              onPress={() => handleLogLevelChange(level)}
            >
              <Text style={{ color: logLevel === level ? 'white' : colors.text }}>
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
       <TouchableOpacity style={[styles.button, { backgroundColor: colors.primary }]} onPress={viewLogs}>
        <Text style={styles.buttonText}>View Logs</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  settingLabel: {
    fontSize: 16,
  },
  logLevelContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  logLevelButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  button: {
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
