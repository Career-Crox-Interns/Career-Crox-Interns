import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { applyCustomTheme, clearCustomTheme, defaultCustomTheme } from './theme';

const AuthContext = createContext(null);

function parseTheme(raw) {
  if (!raw) return defaultCustomTheme;
  try { return { ...defaultCustomTheme, ...JSON.parse(raw) }; } catch { return defaultCustomTheme; }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booted, setBooted] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('careerCroxTheme') || 'peach-sky');
  const [customTheme, setCustomTheme] = useState(parseTheme(localStorage.getItem('careerCroxCustomTheme')));

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('careerCroxTheme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('careerCroxCustomTheme', JSON.stringify(customTheme));
    applyCustomTheme(customTheme);
  }, [customTheme]);

  useEffect(() => {
    api.get('/api/auth/me')
      .then((data) => {
        setUser(data.user || null);
        if (data.user?.theme_name) setTheme(data.user.theme_name);
        if (data.user?.custom_theme_json) setCustomTheme(parseTheme(data.user.custom_theme_json));
      })
      .catch(() => setUser(null))
      .finally(() => setBooted(true));
  }, []);

  useEffect(() => {
    function handleAuthExpired(event) {
      try {
        const message = event?.detail?.message || 'Session expired. Logged out because this account was used on another device.';
        sessionStorage.setItem('careerCroxSessionExpiredMessage', message);
      } catch {}
      setUser(null);
    }
    window.addEventListener('career-crox-auth-expired', handleAuthExpired);
    return () => window.removeEventListener('career-crox-auth-expired', handleAuthExpired);
  }, []);

  const value = useMemo(() => ({
    user,
    booted,
    theme,
    setTheme,
    customTheme,
    setCustomTheme,
    resetCustomTheme() {
      setCustomTheme(defaultCustomTheme);
      clearCustomTheme();
      localStorage.removeItem('careerCroxCustomTheme');
    },
    async persistTheme(nextTheme = theme, nextCustomTheme = customTheme) {
      await api.post('/api/theme', { theme_name: nextTheme, custom_theme_json: JSON.stringify(nextCustomTheme) });
    },
    async login(username, password) {
      const data = await api.post('/api/auth/login', { username, password });
      setUser(data.user);
      if (data.user?.theme_name) setTheme(data.user.theme_name);
      if (data.user?.custom_theme_json) setCustomTheme(parseTheme(data.user.custom_theme_json));
      return data;
    },
    async logout() {
      await api.post('/api/auth/logout', {});
      setUser(null);
    }
  }), [user, booted, theme, customTheme]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
