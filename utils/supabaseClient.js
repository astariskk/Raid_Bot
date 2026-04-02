import { createRequire } from 'module';

let supabase = null;

export function getSupabase() {
    if (supabase) return supabase;

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!url) throw new Error('SUPABASE_URL is not defined.');
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) is not defined.');

    const require = createRequire(import.meta.url);
    // Lazy-load so the repo can still be imported without deps installed.
    const { createClient } = require('@supabase/supabase-js');

    supabase = createClient(url, key, {
        auth: { persistSession: false },
    });
    return supabase;
}
