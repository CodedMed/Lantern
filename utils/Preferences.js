import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  sanitizeSettings,
} from "./preferences.mjs";
const Context = createContext(null);
export function PreferencesProvider({ children }) {
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((value) => {
        if (active) {
          try {
            setSettings(sanitizeSettings(JSON.parse(value)));
          } catch {
            /* defaults */
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (loaded)
      AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)).catch(
        () => {},
      );
  }, [loaded, settings]);
  const update = (key, value) =>
    setSettings((current) => sanitizeSettings({ ...current, [key]: value }));
  return (
    <Context.Provider value={{ settings, update }}>{children}</Context.Provider>
  );
}
export const usePreferences = () => useContext(Context);
