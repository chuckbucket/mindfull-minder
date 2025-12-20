import * as FileSystem from 'expo-file-system/legacy';
import { logger, consoleTransport } from 'react-native-logs';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

console.log("---- LOGGER V12 (Final Fix) ----"); // Diagnostic log

const MINDERS_STORAGE_KEY = '@minders';
const LOG_DIRECTORY = `${FileSystem.documentDirectory}logs/`;
const LOG_LIMIT = 5; // Keep last 5 log files
const MAX_LOG_SIZE_BYTES = 1024 * 1024; // 1 MB
const LOG_LEVEL_KEY = '@logLevel';

const logLevels = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const getLogFileName = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    return `app-${year}-${month}-${day}.log`;
};

const ensureDirExists = async () => {
  const dirInfo = await FileSystem.getInfoAsync(LOG_DIRECTORY);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(LOG_DIRECTORY, { intermediates: true });
  }
};

// A simple, direct-to-file logger that bypasses the problematic transports
const writeToFile = async (message) => {
    try {
        await ensureDirExists();
        const logFilePath = `${LOG_DIRECTORY}${getLogFileName()}`;
        await FileSystem.writeAsStringAsync(logFilePath, message + '\n', {
            encoding: FileSystem.EncodingType.UTF8,
            append: true,
        });
    } catch (error) {
        console.error("Failed to write to log file:", error);
    }
};


// Base logger for console output
const consoleLogger = logger.createLogger({
  levels: logLevels,
  severity: 'debug',
  transport: consoleTransport, // Only use consoleTransport
  transportOptions: {
    colors: {
      debug: 'greenBright',
      info: 'blueBright',
      warn: 'yellowBright',
      error: 'redBright',
    },
  },
  async: true,
  dateFormat: 'iso',
  printLevel: true,
  printDate: true,
  enabled: true,
});

// Create a custom log object that combines console and file logging
const createHybridLogger = () => {
    const hybridLog = {};
    Object.keys(logLevels).forEach(level => {
        hybridLog[level] = (...args) => {
            // 1. Log to the console using react-native-logs
            consoleLogger[level](...args);

            // 2. Format and write to our custom file logger
            const message = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${args.map(a => JSON.stringify(a)).join(' ')}`;
            writeToFile(message);
        };
    });
    return hybridLog;
};

export const log = createHybridLogger();

export const setLogLevel = async (level: 'debug' | 'info' | 'warn' | 'error') => {
  consoleLogger.setSeverity(level);
  await AsyncStorage.setItem(LOG_LEVEL_KEY, level);
  log.info(`Log level set to: ${level}`);
};

const truncateLogFileIfNeeded = async () => {
  const logFilePath = `${LOG_DIRECTORY}${getLogFileName()}`;
  try {
    const logInfo = await FileSystem.getInfoAsync(logFilePath);
    if (logInfo.exists && logInfo.size > MAX_LOG_SIZE_BYTES) {
        const currentLogContent = await FileSystem.readAsStringAsync(logFilePath);
        const halfLogContent = currentLogContent.substring(Math.floor(MAX_LOG_SIZE_BYTES / 2));
        await FileSystem.writeAsStringAsync(logFilePath, '........ TRUNCATED........\r\n' + halfLogContent);
        log.info('Log file was truncated due to size.');
    }
  } catch (error) {
    // It's okay if the file doesn't exist yet
  }
};

const deleteOldLogs = async () => {
  try {
    await ensureDirExists();
    const files = await FileSystem.readDirectoryAsync(LOG_DIRECTORY);
    const logFiles = files.filter(file => file.endsWith('.log')).sort();
    if (logFiles.length > LOG_LIMIT) {
      const filesToDelete = logFiles.slice(0, logFiles.length - LOG_LIMIT);
      for (const file of filesToDelete) {
        await FileSystem.deleteAsync(`${LOG_DIRECTORY}${file}`);
        log.info(`Deleted old log file: ${file}`);
      }
    }
  } catch (error) {
      log.error('Error deleting old logs:', error)
  }
};

export const initializeLogging = async () => {
    const storedLevel = await AsyncStorage.getItem(LOG_LEVEL_KEY) as 'debug' | 'info' | 'warn' | 'error' | null;
    if (storedLevel) {
        consoleLogger.setSeverity(storedLevel);
    }
    await deleteOldLogs();
    await truncateLogFileIfNeeded();
    log.info('Logger initialized.');
}

export const logAppStartup = async (appVersion: string) => {
    const storedMinders = await AsyncStorage.getItem(MINDERS_STORAGE_KEY);
    const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();

    log.info('--- App Startup ---');
    log.info(`Version: ${appVersion}`);
    log.info(`Time: ${new Date().toLocaleString()}`);
    log.info('--- Stored Minders ---');
    try {
        log.info(JSON.parse(storedMinders || '[]'));
    } catch {
        log.warn('Could not parse stored minders', storedMinders);
    }
    log.info('--- Scheduled Notifications ---');
    log.info(scheduledNotifications);
    log.info('-------------------');
}

export const getLogs = async () => {
    await ensureDirExists();
    const files = await FileSystem.readDirectoryAsync(LOG_DIRECTORY);
    const logFiles = files.filter(file => file.endsWith('.log')).sort().reverse();
    let allLogs = '';
    for (const file of logFiles) {
        allLogs += `--- Log File: ${file} ---\n`;
        allLogs += await FileSystem.readAsStringAsync(`${LOG_DIRECTORY}${file}`);
        allLogs += '\n\n';
    }
    return allLogs;
}
