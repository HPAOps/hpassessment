import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getSettings, updateSettings as apiUpdateSettings } from "@/lib/api";

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getSettings().then(s => { if (mounted) { setSettings(s); setLoading(false); } });
    return () => { mounted = false; };
  }, []);

  const update = useCallback(async (patch, actor) => {
    const next = await apiUpdateSettings(patch, actor);
    setSettings(next);
    return next;
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loading, update }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be inside SettingsProvider");
  return ctx;
}
