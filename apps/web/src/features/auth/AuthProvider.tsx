import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { AuthContext, type AuthContextValue } from './context';
import { toAuthMessage } from './errors';
import { parseSafeRedirect } from './redirect';
import { getOptionalSupabaseClient, isSupabaseConfigured } from './supabase';

const normalizedEmail = (email: string): string => email.trim().toLowerCase();

const callbackUrl = (redirect: string, flow?: 'recovery'): string => {
  const callback = new URL('/auth/callback', window.location.origin);
  callback.searchParams.set('redirect', parseSafeRedirect(redirect));
  if (flow) callback.searchParams.set('flow', flow);
  return callback.toString();
};

export function AuthProvider({
  children,
  client: providedClient,
}: PropsWithChildren<{ client?: SupabaseClient | null }>) {
  const [client, setClient] = useState<SupabaseClient | null>(providedClient ?? null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(
    providedClient === undefined ? isSupabaseConfigured() : Boolean(providedClient),
  );
  const [initializationError, setInitializationError] = useState<string | null>(null);
  useEffect(() => {
    if (providedClient !== undefined || !isSupabaseConfigured()) return;
    let active = true;
    void getOptionalSupabaseClient()
      .then((loadedClient) => {
        if (!active) return;
        setClient(loadedClient);
        if (!loadedClient) setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setInitializationError('登录模块暂时无法加载，请刷新页面后重试。');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [providedClient]);
  useEffect(() => {
    if (!client) return;
    let active = true;
    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        setSession(data.session);
        setInitializationError(
          error ? toAuthMessage(error, '无法恢复登录状态，请重新登录。') : null,
        );
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
        setInitializationError('无法恢复登录状态，请检查网络后重试。');
        setLoading(false);
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
      client,
      loading,
      initializationError,
      session,
      user: session?.user ?? null,
      async signIn(email, password) {
        if (!client) throw new Error('Supabase 尚未配置');
        const { error } = await client.auth.signInWithPassword({
          email: normalizedEmail(email),
          password,
        });
        if (error) throw new Error(toAuthMessage(error));
      },
      async signUp(email, password, redirect = '/boards') {
        if (!client) throw new Error('Supabase 尚未配置');
        const { data, error } = await client.auth.signUp({
          email: normalizedEmail(email),
          password,
          options: { emailRedirectTo: callbackUrl(redirect) },
        });
        if (error) throw new Error(toAuthMessage(error));
        return { requiresEmailConfirmation: !data.session };
      },
      async requestPasswordReset(email) {
        if (!client) throw new Error('Supabase 尚未配置');
        const { error } = await client.auth.resetPasswordForEmail(normalizedEmail(email), {
          redirectTo: callbackUrl('/reset-password', 'recovery'),
        });
        if (error) throw new Error(toAuthMessage(error));
      },
      async resendSignUpConfirmation(email, redirect = '/boards') {
        if (!client) throw new Error('Supabase 尚未配置');
        const { error } = await client.auth.resend({
          type: 'signup',
          email: normalizedEmail(email),
          options: { emailRedirectTo: callbackUrl(redirect) },
        });
        if (error) throw new Error(toAuthMessage(error));
      },
      async updatePassword(password) {
        if (!client) throw new Error('Supabase 尚未配置');
        const { error } = await client.auth.updateUser({ password });
        if (error) throw new Error(toAuthMessage(error));
      },
      async signInWithOAuth(provider, redirect) {
        if (!client) throw new Error('Supabase 尚未配置');
        const target = parseSafeRedirect(redirect);
        const { error } = await client.auth.signInWithOAuth({
          provider,
          options: { redirectTo: callbackUrl(target), skipBrowserRedirect: false },
        });
        if (error) throw new Error(toAuthMessage(error));
      },
      async signOut() {
        if (!client) return;
        const { error } = await client.auth.signOut();
        if (error) throw new Error(toAuthMessage(error));
        setSession(null);
      },
    }),
    [client, initializationError, loading, session],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
