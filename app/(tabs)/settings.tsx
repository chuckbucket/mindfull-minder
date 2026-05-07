import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, ScrollView, Share, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useTheme } from '../../context/ThemeContext';
import { themes } from '../../styles/themes';
import { setLogLevel, getLogs } from '../../logic/Logger';
import { scheduleNotificationsForAllMinders } from '../../logic/NotificationManager';
import { CHANGELOG, type ChangelogBullet } from '../../constants/changelog';

const LOG_LEVEL_KEY = '@logLevel';
const MINDERS_KEY = '@minders';
const EVENTS_KEY = '@minderEvents';
const QUIET_HOURS_KEY = '@quietHours';

const TIME_OPTIONS: string[] = [];
for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  TIME_OPTIONS.push(`${hh}:${mm}`);
}

const formatTimeLabel = (hhmm: string): string => {
  const [h, m] = hhmm.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
};

const PRIVACY_POLICY = `Privacy Policy — Mindfull Minder

Last updated: ${new Date().getFullYear()}

All your data — minders, reminders, mood logs, and reflections — is stored locally on your device. Nothing is sent to any server or third party.

• No account required
• No data leaves your device
• No analytics or tracking
• You can delete all data by uninstalling the app

If you have questions, contact the developer through the App Store listing.`;

const THEME_LABELS: Record<string, string> = {
  colorful: 'Colorful',
  dark: 'Dark',
  pastel: 'Pastel',
  neon: 'Neon',
};

const parseChangelogBullet = (rawBullet: string): ChangelogBullet => {
  const match = rawBullet.match(/^\((N|F|I)\)\s*(.+)$/);
  if (!match) {
    return { type: 'I', text: rawBullet };
  }
  return { type: match[1] as ChangelogBullet['type'], text: match[2] };
};

const bulletIcon: Record<
  ChangelogBullet['type'],
  { name: React.ComponentProps<typeof MaterialCommunityIcons>['name']; color: string; size: number }
> = {
  N: { name: 'new-box', color: 'darkgoldenrod', size: 15 },
  F: { name: 'wrench', color: 'darkgreen', size: 12 },
  I: { name: 'information-outline', color: '#3b82f6', size: 12 },
};

export default function SettingsScreen() {
  const { colors, themeName, setScheme } = useTheme();
  const router = useRouter();
  const [logLevel, setLogLevelState] = useState('info');
  const [privacyVisible, setPrivacyVisible] = useState(false);
  const [quietEnabled, setQuietEnabled] = useState(false);
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('07:00');
  const [qhPickerVisible, setQhPickerVisible] = useState(false);
  const [qhPickerTarget, setQhPickerTarget] = useState<'start' | 'end'>('start');
  const qhPickerScrollRef = useRef<ScrollView>(null);
  const appVersion = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? 'unknown';
  const buildNumber = Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? Constants.nativeBuildVersion ?? 'unknown';
  const updateCreatedAt = Updates.createdAt ? new Date(Updates.createdAt).toISOString() : 'unknown';
  const appOwnership = Constants.appOwnership ?? 'unknown';

  useEffect(() => {
    const load = async () => {
      const storedLevel = await AsyncStorage.getItem(LOG_LEVEL_KEY) as 'debug' | 'info' | 'warn' | 'error' | null;
      if (storedLevel) setLogLevelState(storedLevel);

      const qhRaw = await AsyncStorage.getItem(QUIET_HOURS_KEY);
      if (qhRaw) {
        try {
          const qh = JSON.parse(qhRaw);
          if (typeof qh.enabled === 'boolean') setQuietEnabled(qh.enabled);
          if (typeof qh.start === 'string') setQuietStart(qh.start);
          if (typeof qh.end === 'string') setQuietEnd(qh.end);
        } catch {
          // ignore
        }
      }
    };
    void load();
  }, []);

  useEffect(() => {
    if (!qhPickerVisible) return;
    const selected = qhPickerTarget === 'start' ? quietStart : quietEnd;
    const idx = TIME_OPTIONS.indexOf(selected);
    if (idx < 0) return;
    const ITEM_HEIGHT = 42;
    const offset = Math.max(0, idx * ITEM_HEIGHT - ITEM_HEIGHT * 2);
    setTimeout(() => qhPickerScrollRef.current?.scrollTo({ y: offset, animated: false }), 50);
  }, [qhPickerVisible, qhPickerTarget, quietStart, quietEnd]);

  const persistQuietHours = useCallback(async (enabled: boolean, start: string, end: string) => {
    await AsyncStorage.setItem(QUIET_HOURS_KEY, JSON.stringify({ enabled, start, end }));
    void scheduleNotificationsForAllMinders();
  }, []);

  const handleQuietToggle = async (value: boolean) => {
    setQuietEnabled(value);
    await persistQuietHours(value, quietStart, quietEnd);
  };

  const handleQhTimeSelect = async (time: string) => {
    if (qhPickerTarget === 'start') {
      setQuietStart(time);
      await persistQuietHours(quietEnabled, time, quietEnd);
    } else {
      setQuietEnd(time);
      await persistQuietHours(quietEnabled, quietStart, time);
    }
    setQhPickerVisible(false);
  };

  const handleLogLevelChange = (level: 'debug' | 'info' | 'warn' | 'error') => {
    setLogLevel(level);
    setLogLevelState(level);
  };

  const viewLogs = async () => {
    const logs = await getLogs();
    Alert.alert('App Logs', logs, [{ text: 'Close' }], { cancelable: true });
  };

  const handleExport = async () => {
    try {
      const mindersRaw = await AsyncStorage.getItem(MINDERS_KEY);
      const eventsRaw = await AsyncStorage.getItem(EVENTS_KEY);
      const exportData = {
        exportedAt: new Date().toISOString(),
        appVersion: '1.0.0',
        minders: mindersRaw ? JSON.parse(mindersRaw) : [],
        events: eventsRaw ? JSON.parse(eventsRaw) : [],
      };
      await Share.share({
        message: JSON.stringify(exportData, null, 2),
        title: 'Mindfull Minder Export',
      });
    } catch {
      Alert.alert('Export Failed', 'Could not export your data. Please try again.');
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={() => router.push('/holidays')}
        accessibilityLabel="Manage holiday reminders"
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>🎉 Holiday Reminders</Text>
      </TouchableOpacity>

      <Text style={[styles.sectionHeader, { color: colors.text }]}>Theme</Text>
      <View style={styles.themeGrid}>
        {(Object.keys(THEME_LABELS) as (keyof typeof themes)[]).map(key => {
          const theme = themes[key];
          const isSelected = themeName === key;
          return (
            <TouchableOpacity
              key={key}
              style={[
                styles.themeChip,
                {
                  backgroundColor: theme.colors.card,
                  borderColor: isSelected ? theme.colors.primary : colors.border,
                  borderWidth: isSelected ? 2.5 : 1,
                },
              ]}
              onPress={() => setScheme(key)}
              accessibilityLabel={`Switch to ${THEME_LABELS[key]} theme`}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
            >
              <View style={[styles.themePreviewDot, { backgroundColor: theme.colors.primary }]} />
              <Text style={[styles.themeChipText, { color: theme.dark ? '#fff' : '#333' }]}>
                {THEME_LABELS[key]}
              </Text>
              {isSelected && (
                <Text style={[styles.themeCheckmark, { color: theme.colors.primary }]}>✓</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={[styles.sectionHeader, { color: colors.text }]}>Quiet Hours</Text>
      <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.settingLabel, { color: colors.text }]}>Do Not Disturb</Text>
          <Text style={[styles.settingSubLabel, { color: colors.text }]}>
            Suppress all notifications in this window
          </Text>
        </View>
        <Switch
          value={quietEnabled}
          onValueChange={handleQuietToggle}
          accessibilityLabel="Toggle quiet hours"
        />
      </View>
      {quietEnabled && (
        <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.settingLabel, { color: colors.text }]}>No notifications</Text>
          <View style={styles.timeWindowRow}>
            <TouchableOpacity
              style={[styles.timeChip, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => { setQhPickerTarget('start'); setQhPickerVisible(true); }}
              accessibilityLabel={`Quiet hours start: ${formatTimeLabel(quietStart)}`}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.primary, fontWeight: '600' }}>{formatTimeLabel(quietStart)}</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.text, opacity: 0.6 }}>–</Text>
            <TouchableOpacity
              style={[styles.timeChip, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => { setQhPickerTarget('end'); setQhPickerVisible(true); }}
              accessibilityLabel={`Quiet hours end: ${formatTimeLabel(quietEnd)}`}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.primary, fontWeight: '600' }}>{formatTimeLabel(quietEnd)}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Text style={[styles.sectionHeader, { color: colors.text }]}>Developer</Text>
      <View style={[styles.settingRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.settingLabel, { color: colors.text }]}>Log Level</Text>
        <View style={styles.logLevelContainer}>
          {(['info', 'warn', 'error'] as const).map((level) => (
            <TouchableOpacity
              key={level}
              style={[
                styles.logLevelButton,
                { backgroundColor: logLevel === level ? colors.primary : colors.card },
              ]}
              onPress={() => handleLogLevelChange(level)}
              accessibilityLabel={`Set log level to ${level}`}
              accessibilityRole="button"
              accessibilityState={{ selected: logLevel === level }}
            >
              <Text style={{ color: logLevel === level ? 'white' : colors.text }}>
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={handleExport}
        accessibilityLabel="Export all your data as JSON"
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>Export My Data</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}
        onPress={viewLogs}
        accessibilityLabel="View debug logs"
        accessibilityRole="button"
      >
        <Text style={[styles.buttonText, { color: colors.text }]}>View Debug Logs</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.linkRow, { borderTopColor: colors.border }]}
        onPress={() => setPrivacyVisible(true)}
        accessibilityLabel="View privacy policy"
        accessibilityRole="button"
      >
        <Text style={[styles.linkLabel, { color: colors.primary }]}>Privacy Policy</Text>
        <Text style={{ color: colors.text, opacity: 0.5 }}>›</Text>
      </TouchableOpacity>

      <Modal
        transparent
        animationType="slide"
        visible={privacyVisible}
        onRequestClose={() => setPrivacyVisible(false)}
        accessibilityViewIsModal
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Privacy Policy</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              <Text style={[styles.modalBody, { color: colors.text }]}>{PRIVACY_POLICY}</Text>
            </ScrollView>
            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: colors.primary }]}
              onPress={() => setPrivacyVisible(false)}
              accessibilityLabel="Close privacy policy"
              accessibilityRole="button"
            >
              <Text style={{ color: 'white', fontWeight: '700' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        animationType="fade"
        visible={qhPickerVisible}
        onRequestClose={() => setQhPickerVisible(false)}
        accessibilityViewIsModal
      >
        <View style={styles.pickerOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setQhPickerVisible(false)} />
          <View style={[styles.pickerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: 12 }}>
              Select {qhPickerTarget === 'start' ? 'Start' : 'End'} Time
            </Text>
            <ScrollView ref={qhPickerScrollRef} style={{ maxHeight: 300 }}>
              {TIME_OPTIONS.map(option => {
                const isSelected = (qhPickerTarget === 'start' ? quietStart : quietEnd) === option;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[styles.pickerOption, { backgroundColor: isSelected ? colors.primary : 'transparent' }]}
                    onPress={() => handleQhTimeSelect(option)}
                  >
                    <Text style={{ color: isSelected ? 'white' : colors.text, paddingVertical: 10 }}>
                      {formatTimeLabel(option)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Text style={[styles.sectionHeader, { color: colors.text }]}>Build & Updates</Text>
      <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.infoRow}>
          <Text style={[styles.infoKey, { color: colors.text }]}>App Version</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>{String(appVersion)}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={[styles.infoKey, { color: colors.text }]}>Build</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>{String(buildNumber)}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={[styles.infoKey, { color: colors.text }]}>Runtime Version</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>{Updates.runtimeVersion ?? 'unknown'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={[styles.infoKey, { color: colors.text }]}>Update Channel</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>{Updates.channel ?? 'unknown'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={[styles.infoKey, { color: colors.text }]}>Update ID</Text>
          <Text style={[styles.infoValue, { color: colors.text }]} numberOfLines={1}>
            {Updates.updateId ?? 'embedded/dev'}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={[styles.infoKey, { color: colors.text }]}>Launch Type</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {Updates.isEmbeddedLaunch ? 'Embedded' : 'Downloaded OTA'}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={[styles.infoKey, { color: colors.text }]}>Update Created</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>{updateCreatedAt}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={[styles.infoKey, { color: colors.text }]}>Ownership</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>{appOwnership}</Text>
        </View>
      </View>

      <Text style={[styles.sectionHeader, { color: colors.text }]}>Revision Log</Text>
      <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {CHANGELOG.map((entry) => (
          <View
            key={`${entry.version}-${entry.title}`}
            style={[styles.logEntry, { borderBottomColor: colors.border }]}
          >
            <Text style={[styles.logEntryTitle, { color: colors.text }]}>
              v{entry.version} · {entry.title}
            </Text>
            {entry.date ? <Text style={[styles.logEntryDate, { color: colors.text }]}>{entry.date}</Text> : null}
            {entry.bullets.map((bullet, index) => {
              const parsedBullet = parseChangelogBullet(bullet);
              return (
                <View key={`${entry.version}-${index}`} style={styles.logBulletRow}>
                  <View style={styles.logBulletIconWrap}>
                    <MaterialCommunityIcons
                      name={bulletIcon[parsedBullet.type].name}
                      size={bulletIcon[parsedBullet.type].size}
                      color={bulletIcon[parsedBullet.type].color}
                    />
                  </View>
                  <Text style={[styles.logBulletText, { color: colors.text }]}>{parsedBullet.text}</Text>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    opacity: 0.55,
    marginTop: 20,
    marginBottom: 10,
  },
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 4,
  },
  themeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    minWidth: '45%',
  },
  themePreviewDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  themeChipText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  themeCheckmark: {
    fontSize: 14,
    fontWeight: '700',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    marginBottom: 4,
  },
  settingLabel: {
    fontSize: 16,
  },
  settingSubLabel: {
    fontSize: 12,
    opacity: 0.55,
    marginTop: 2,
  },
  timeWindowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
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
    marginTop: 16,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 16,
    borderTopWidth: 1,
  },
  linkLabel: {
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: '#00000055',
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: 24,
    gap: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalBody: {
    fontSize: 14,
    lineHeight: 22,
    opacity: 0.85,
  },
  closeButton: {
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: '#00000040',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCard: {
    width: '80%',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  pickerOption: {
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  infoCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  infoKey: {
    fontSize: 13,
    opacity: 0.7,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  logEntry: {
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  logEntryTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  logEntryDate: {
    fontSize: 12,
    opacity: 0.55,
    marginTop: 2,
    marginBottom: 6,
  },
  logBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 4,
  },
  logBulletIconWrap: {
    marginTop: 2,
    marginRight: 4,
    width: 16,
    alignItems: 'center',
  },
  logBulletText: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
});
