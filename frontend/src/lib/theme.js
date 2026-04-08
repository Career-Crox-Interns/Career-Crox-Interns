export const defaultCustomTheme = {
  hue: 0,
  primary: '#ff9a56',
  secondary: '#ff6d7d',
  accent: '#7bc9ff',
  button: '#4f7dff',
};

export function applyCustomTheme(theme) {
  const root = document.documentElement;
  if (!theme) return;
  root.style.setProperty('--grad-1-a', theme.primary || defaultCustomTheme.primary);
  root.style.setProperty('--grad-1-b', theme.secondary || defaultCustomTheme.secondary);
  root.style.setProperty('--grad-2-a', theme.accent || defaultCustomTheme.accent);
  root.style.setProperty('--grad-2-b', theme.button || defaultCustomTheme.button);
  root.style.setProperty('--custom-hue-rotate', `${Number(theme.hue || 0)}deg`);
}

export function clearCustomTheme() {
  const root = document.documentElement;
  ['--grad-1-a','--grad-1-b','--grad-2-a','--grad-2-b','--custom-hue-rotate'].forEach((key) => root.style.removeProperty(key));
}
