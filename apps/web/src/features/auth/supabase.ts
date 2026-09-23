import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let singleton: SupabaseClient | null = null;

export const isSupabaseConfigured = (): boolean =>
  Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

export const isOAuthProviderEnabled = (provider: 'google' | 'github'): boolean =>
  provider === 'google'
    ? import.meta.env.VITE_AUTH_GOOGLE_ENABLED === 'true'
    : import.meta.env.VITE_AUTH_GITHUB_ENABLED === 'true';

export const getSupabaseClient = (): SupabaseClient => {
  if (singleton) return singleton;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase 浏览器配置尚未完成');
  singleton = createClient(url, key, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return singleton;
};

export const getOptionalSupabaseClient = (): SupabaseClient | null =>
  isSupabaseConfigured() ? getSupabaseClient() : null;

export const completeAuthCallback = async (client: SupabaseClient, code: string): Promise<void> => {
  if (!code) throw new Error('OAuth 回调缺少授权码');
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) throw error;
};

export const completeOAuthCallback = completeAuthCallback;
