import React, { createContext, useState, useContext, useMemo, useEffect } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { themes } from '../styles/themes';

const THEME_STORAGE_KEY = '@theme';

export const ThemeContext = createContext({
  themeName: 'colorful',
  isDark: false,
  colors: themes.colorful.colors,
  setScheme: (scheme: string) => {},
});

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const colorScheme = Appearance.getColorScheme();
  const [themeName, setThemeName] = useState('colorful');

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const storedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (storedTheme) {
          setThemeName(storedTheme);
        } else {
          setThemeName(colorScheme === 'dark' ? 'dark' : 'colorful');
        }
      } catch (e) {
        // ignore
      }
    };
    loadTheme();
  }, [colorScheme]);

  const setScheme = async (scheme: string) => {
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, scheme);
      setThemeName(scheme);
    } catch (e) {
        // ignore
    }
  };

  const theme = useMemo(() => {
    const currentTheme = themes[themeName as keyof typeof themes] || themes.colorful;
    return {
      themeName,
      isDark: currentTheme.dark,
      colors: currentTheme.colors,
      setScheme,
    };
  }, [themeName]);

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
