import { useSyncExternalStore } from 'react';

const subscribe = (notify: () => void): (() => void) => {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
};

const currentStatus = (): boolean => navigator.onLine;

export const useOnlineStatus = (): boolean =>
  useSyncExternalStore(subscribe, currentStatus, () => true);
