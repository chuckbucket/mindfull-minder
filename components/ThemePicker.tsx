import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { themes } from '../styles/themes';

export default function ThemePicker() {
  const { themeName, setScheme, colors } = useTheme();

  return (
    <View>
      <Text style={[styles.label, { color: colors.text }]}>Choose Theme</Text>
      <View style={styles.container}>
        {Object.keys(themes).map((key) => (
          <TouchableOpacity
            key={key}
            style={[
              styles.themeButton,
              {
                backgroundColor: themes[key as keyof typeof themes].colors.primary,
                borderColor: themeName === key ? colors.primary : colors.border,
              },
            ]}
            onPress={() => setScheme(key)}
          >
            <Text style={[styles.themeButtonText, { color: themes[key as keyof typeof themes].colors.text }]}>
              {key.charAt(0).toUpperCase() + key.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
  },
  themeButton: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    margin: 4,
    alignItems: 'center',
    width: '45%',
  },
  themeButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
});
