import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let singleton: SupabaseClient | null = null;

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
      detectSessionInUrl: true,
    },
  });
  return singleton;
};

export const completeOAuthCallback = async (
  client: SupabaseClient,
  code: string,
): Promise<void> => {
  if (!code) throw new Error('OAuth 回调缺少授权码');
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) throw error;
};
