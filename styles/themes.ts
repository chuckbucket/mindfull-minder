export const ColorfulTheme = {
  dark: false,
  colors: {
    primary: '#007BFF',
    background: '#FFFFFF',
    card: '#F0F0F0',
    text: '#333333',
    border: '#CCCCCC',
    notification: '#FF69B4',
    // Palette for minder items
    palette: {
      blue: '#00BFFF',
      orange: '#FFA500',
      green: '#ADFF2F',
      pink: '#FF69B4',
      purple: '#9370DB',
    }
  },
};

export const DarkTheme = {
  dark: true,
  colors: {
    primary: '#007BFF',
    background: '#121212',
    card: '#1E1E1E',
    text: '#FFFFFF',
    border: '#333333',
    notification: '#FF69B4',
    // Palette for minder items
    palette: {
      blue: '#00BFFF',
      orange: '#FFA500',
      green: '#ADFF2F',
      pink: '#FF69B4',
      purple: '#9370DB',
    }
  },
};

export const PastelTheme = {
  dark: false,
  colors: {
    primary: '#FFB6C1', // Light Pink
    background: '#F5F5DC', // Beige
    card: '#FFF0F5', // Lavender Blush
    text: '#778899', // Light Slate Gray
    border: '#D3D3D3', // Light Gray
    notification: '#FFC0CB',
    palette: {
      blue: '#ADD8E6', // Light Blue
      orange: '#FFDAB9', // Peach Puff
      green: '#98FB98', // Pale Green
      pink: '#FFC0CB', // Pink
      purple: '#E6E6FA', // Lavender
    }
  }
};

export const NeonTheme = {
  dark: true,
  colors: {
    primary: '#39FF14', // Neon Green
    background: '#000000', // Black
    card: '#1A1A1A',
    text: '#FFFFFF', // White
    border: '#FF00FF', // Magenta
    notification: '#FF00FF',
    palette: {
      blue: '#00FFFF', // Cyan
      orange: '#FFA500', // Orange
      green: '#39FF14', // Neon Green
      pink: '#FF00FF', // Magenta
      purple: '#8A2BE2', // Blue Violet
    }
  }
};

export const themes = {
  colorful: ColorfulTheme,
  dark: DarkTheme,
  pastel: PastelTheme,
  neon: NeonTheme,
};
