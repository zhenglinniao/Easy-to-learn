const configuredSupabaseOrigin = (): string | null => {
  const configured = import.meta.env.VITE_SUPABASE_URL;
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
};

export const isSafeAssetUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    const expectedOrigin = configuredSupabaseOrigin();
    if (expectedOrigin && url.origin !== expectedOrigin) return false;
    if (url.protocol === 'https:') return true;
    return (
      import.meta.env.DEV &&
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    );
  } catch {
    return false;
  }
};
