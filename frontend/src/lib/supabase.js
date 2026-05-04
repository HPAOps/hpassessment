import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || "";
const FORCE_DEMO = process.env.REACT_APP_FORCE_DEMO === "true";

// Demo mode is active when env vars aren't configured OR when FORCE_DEMO is set.
// In demo mode the app uses an in-memory store (see demoData.js + api.js).
// Set REACT_APP_FORCE_DEMO=false (or remove it) once your Supabase project has
// the schema, RLS, storage buckets, RPCs, and staff auth users in place.
export const isDemoMode = FORCE_DEMO || !SUPABASE_URL || !SUPABASE_ANON_KEY;

export const supabase = (!SUPABASE_URL || !SUPABASE_ANON_KEY)
  ? null
  : createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });

export const SUPABASE_INFO = {
  url: SUPABASE_URL,
  hasKey: Boolean(SUPABASE_ANON_KEY),
  forceDemo: FORCE_DEMO,
  demoMode: isDemoMode,
};
