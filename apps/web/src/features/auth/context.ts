import type { Session, User } from '@supabase/supabase-js';
import { createContext, useContext } from 'react';

export interface AuthContextValue {
  loading: boolean;
  initializationError: string | null;
  user: User | null;
  session: Session | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(
    email: string,
    password: string,
    redirect?: string,
  ): Promise<{ requiresEmailConfirmation: boolean }>;
  requestPasswordReset(email: string): Promise<void>;
  resendSignUpConfirmation(email: string, redirect?: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signInWithOAuth(provider: 'google' | 'github', redirect?: string): Promise<void>;
  signOut(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = (): AuthContextValue => {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return value;
};
