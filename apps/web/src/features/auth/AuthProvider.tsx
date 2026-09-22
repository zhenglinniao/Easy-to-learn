import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { AuthContext, type AuthContextValue } from './context';
import { parseSafeRedirect } from './redirect';
import { getOptionalSupabaseClient } from './supabase';

export function AuthProvider({
  children,
  client = getOptionalSupabaseClient(),
}: PropsWithChildren<{ client?: SupabaseClient | null }>) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(client));
  useEffect(() => {
    if (!client) {
      return;
    }
    let active = true;
    void client.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setLoading(false);
      }
    });
    const { data } = client.auth.onAuthStateChange((_event: AuthChangeEvent, next) => {
      if (active) {
        setSession(next);
        setLoading(false);
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);
  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      async signIn(email, password) {
        if (!client) throw new Error('Supabase 尚未配置');
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      async signUp(email, password) {
        if (!client) throw new Error('Supabase 尚未配置');
        const { error } = await client.auth.signUp({ email, password });
        if (error) throw error;
      },
      async signInWithOAuth(provider, redirect) {
        if (!client) throw new Error('Supabase 尚未配置');
        const target = parseSafeRedirect(redirect);
        const callback = new URL('/auth/callback', window.location.origin);
        callback.searchParams.set('redirect', target);
        const { error } = await client.auth.signInWithOAuth({
          provider,
          options: { redirectTo: callback.toString(), skipBrowserRedirect: false },
        });
        if (error) throw error;
      },
      async signOut() {
        if (!client) return;
        const { error } = await client.auth.signOut();
        if (error) throw error;
        setSession(null);
      },
    }),
    [client, loading, session],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
