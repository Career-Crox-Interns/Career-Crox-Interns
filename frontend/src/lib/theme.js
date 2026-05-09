export const defaultCustomTheme = {
  hue: 0,
  surface: 52,
  primary: '#ff9a56',
  secondary: '#ff6d7d',
  accent: '#7bc9ff',
  button: '#4f7dff',
  background: '#d9ebff',
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hexToHsl(hex) {
  const clean = String(hex || '').replace('#', '').trim();
  const normalized = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const int = Number.parseInt(normalized || 'd9ebff', 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = 60 * (((g - b) / delta) % 6); break;
      case g: h = 60 * (((b - r) / delta) + 2); break;
      default: h = 60 * (((r - g) / delta) + 4); break;
    }
  }
  if (h < 0) h += 360;
  return { h, s, l };
}

function hslToHex(h, s, l) {
  const sat = clamp(s, 0, 1);
  const light = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = light - c / 2;
  const toHex = (value) => Math.round((value + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

function shiftColor(hex, hueShift = 0, saturationBoost = 1, lightnessAdjust = 0) {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h + Number(hueShift || 0), clamp(s * saturationBoost, 0, 1), clamp(l + lightnessAdjust, 0, 1));
}


export function applyCustomTheme(theme) {
  const root = document.documentElement;
  if (!theme) return;
  const surface = clamp(Number(theme.surface ?? defaultCustomTheme.surface ?? 44), 0, 100);
  const hueShift = Number(theme.hue || 0);
  const saturationBoost = 0.92 + (surface / 100) * 0.98;
  const primary = shiftColor(theme.primary || defaultCustomTheme.primary, hueShift, saturationBoost);
  const secondary = shiftColor(theme.secondary || defaultCustomTheme.secondary, hueShift, saturationBoost);
  const accent = shiftColor(theme.accent || defaultCustomTheme.accent, hueShift, saturationBoost);
  const button = shiftColor(theme.button || defaultCustomTheme.button, hueShift, saturationBoost);
  const background = shiftColor(theme.background || defaultCustomTheme.background, hueShift, 0.52 + (surface / 100) * 1.95, 0.18 - (surface / 100) * 0.28);
  const bgStart = shiftColor(theme.background || defaultCustomTheme.background, hueShift - 8, 0.65 + (surface / 100) * 1.55, 0.26 - (surface / 100) * 0.30);
  const bgMid = shiftColor(theme.background || defaultCustomTheme.background, hueShift, 0.74 + (surface / 100) * 1.70, 0.16 - (surface / 100) * 0.25);
  const bgEnd = shiftColor(theme.background || defaultCustomTheme.background, hueShift + 10, 0.82 + (surface / 100) * 1.88, 0.06 - (surface / 100) * 0.20);
  root.style.setProperty('--grad-1-a', primary);
  root.style.setProperty('--grad-1-b', secondary);
  root.style.setProperty('--grad-2-a', accent);
  root.style.setProperty('--grad-2-b', button);
  root.style.setProperty('--brand-primary', primary);
  root.style.setProperty('--brand-secondary', secondary);
  root.style.setProperty('--brand-accent', accent);
  root.style.setProperty('--brand-button', button);
  root.style.setProperty('--panel-tint-a', accent);
  root.style.setProperty('--panel-tint-b', primary);
  root.style.setProperty('--panel-tint-c', secondary);
  root.style.setProperty('--surface-bg-base', background);
  root.style.setProperty('--app-bg-start', bgStart);
  root.style.setProperty('--app-bg-mid', bgMid);
  root.style.setProperty('--app-bg-end', bgEnd);
  root.style.setProperty('--custom-hue-rotate', `${hueShift}deg`);
  root.style.setProperty('--surface-strength', `${surface}%`);
  root.style.setProperty('--surface-mix-a', `${12 + Math.round(surface * 0.76)}%`);
  root.style.setProperty('--surface-mix-b', `${8 + Math.round(surface * 0.58)}%`);
  root.style.setProperty('--surface-mix-c', `${5 + Math.round(surface * 0.42)}%`);
  root.style.setProperty('--surface-line', `${12 + Math.round(surface * 0.24)}%`);
  root.style.setProperty('--surface-soft-a', `${8 + Math.round(surface * 0.18)}%`);
  root.style.setProperty('--surface-soft-b', `${5 + Math.round(surface * 0.14)}%`);
}

export function clearCustomTheme() {
  const root = document.documentElement;
  ['--grad-1-a','--grad-1-b','--grad-2-a','--grad-2-b','--brand-primary','--brand-secondary','--brand-accent','--brand-button','--panel-tint-a','--panel-tint-b','--panel-tint-c','--surface-bg-base','--app-bg-start','--app-bg-mid','--app-bg-end','--custom-hue-rotate','--surface-strength','--surface-mix-a','--surface-mix-b','--surface-mix-c','--surface-line','--surface-soft-a','--surface-soft-b'].forEach((key) => root.style.removeProperty(key));
}
