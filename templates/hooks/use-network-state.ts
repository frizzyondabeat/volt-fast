import { useCallback, useEffect, useRef, useState } from 'react';

export type NetworkState = 'online' | 'reconnecting' | 'offline';

interface NetworkStateOptions {
  probeUrl?: string;
  pollInterval?: number;
  fetchTimeout?: number;
  offlineThreshold?: number;
}

export function useNetworkState({ 
  probeUrl = '/favicon.ico',
  pollInterval = 15000,
  fetchTimeout = 5000,
  offlineThreshold = 2,
}: NetworkStateOptions = {}): NetworkState {
  const [state, setState] = useState<NetworkState>(() =>
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online'
  );

  const failures = useRef(0);
  const isChecking = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  const checkConnection = useCallback(async () => {
    if (isChecking.current) return;
    isChecking.current = true;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const timeout = setTimeout(() => controller.abort(), fetchTimeout);

    try {
      const res = await fetch(probeUrl, {
        method: 'HEAD',
        cache: 'no-store',
        signal: controller.signal,
      });

      if (res.ok || res.status < 500) {
        failures.current = 0;
        setState('online');
      } else {
        throw new Error(`server error: ${res.status}`);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      failures.current += 1;
      setState(failures.current > offlineThreshold ? 'offline' : 'reconnecting');
    } finally {
      clearTimeout(timeout);
      isChecking.current = false;
    }
  }, [probeUrl, fetchTimeout, offlineThreshold]);

  const handleOnline = useCallback(() => {
    failures.current = 0;
    setState('reconnecting');
    checkConnection();
  }, [checkConnection]);

  const handleOffline = useCallback(() => {
    failures.current = offlineThreshold + 1;
    setState('offline');
  }, [offlineThreshold]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    checkConnection();

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') checkConnection();
    }, pollInterval);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkConnection();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      controllerRef.current?.abort();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkConnection, handleOnline, handleOffline, pollInterval]);

  return state;
}
