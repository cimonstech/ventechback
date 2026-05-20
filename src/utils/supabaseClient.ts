import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseServiceKey } from '../config/env';

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('SUPABASE CONFIG MISSING');
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

console.log('✅ Supabase Admin Client initialized');

export default supabaseAdmin;

