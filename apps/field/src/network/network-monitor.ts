/**
 * ZENTRA Field — Connectivity Awareness Monitor
 * apps/field/src/network/network-monitor.ts
 *
 * Implements real-time network connectivity monitoring.
 *
 * CRITICAL ARCHITECTURAL DISTINCTION:
 * "Network available" is informational ONLY.
 * It NEVER equates to "server synchronization completed".
 * Phase 10 monitors connectivity; actual delta synchronization belongs to Phase 12.
 */

export type NetworkStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';

export type NetworkStatusListener = (status: NetworkStatus) => void;

export interface INetworkMonitor {
  getStatus(): NetworkStatus;
  isOnline(): boolean;
  addListener(listener: NetworkStatusListener): () => void;
  destroy(): void;
}

/**
 * Mock Network Monitor for unit tests, headless CI, and manual simulation
 */
export class MockNetworkMonitor implements INetworkMonitor {
  private currentStatus: NetworkStatus = 'ONLINE';
  private readonly listeners = new Set<NetworkStatusListener>();

  constructor(initialStatus: NetworkStatus = 'ONLINE') {
    this.currentStatus = initialStatus;
  }

  getStatus(): NetworkStatus {
    return this.currentStatus;
  }

  isOnline(): boolean {
    return this.currentStatus === 'ONLINE';
  }

  setStatus(status: NetworkStatus): void {
    if (this.currentStatus !== status) {
      this.currentStatus = status;
      this.notifyListeners();
    }
  }

  addListener(listener: NetworkStatusListener): () => void {
    this.listeners.add(listener);
    // Initial call
    listener(this.currentStatus);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    this.listeners.clear();
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.currentStatus);
    }
  }
}

/**
 * Native NetInfo Network Monitor for physical devices and simulators
 */
export class NetInfoNetworkMonitor implements INetworkMonitor {
  private currentStatus: NetworkStatus = 'UNKNOWN';
  private readonly listeners = new Set<NetworkStatusListener>();
  private unsubscribeNetInfo: (() => void) | null = null;

  constructor() {
    try {
      const NetInfo = require('@react-native-community/netinfo');
      this.unsubscribeNetInfo = NetInfo.addEventListener((state: any) => {
        let status: NetworkStatus = 'UNKNOWN';
        if (state.isConnected === true && state.isInternetReachable !== false) {
          status = 'ONLINE';
        } else if (state.isConnected === false || state.isInternetReachable === false) {
          status = 'OFFLINE';
        }
        this.currentStatus = status;
        this.notifyListeners();
      });
    } catch {
      // Default to unknown if native netinfo module unavailable
      this.currentStatus = 'UNKNOWN';
    }
  }

  getStatus(): NetworkStatus {
    return this.currentStatus;
  }

  isOnline(): boolean {
    return this.currentStatus === 'ONLINE';
  }

  addListener(listener: NetworkStatusListener): () => void {
    this.listeners.add(listener);
    listener(this.currentStatus);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    if (this.unsubscribeNetInfo) {
      this.unsubscribeNetInfo();
      this.unsubscribeNetInfo = null;
    }
    this.listeners.clear();
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.currentStatus);
    }
  }
}

export function createNetworkMonitor(): INetworkMonitor {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
    return new MockNetworkMonitor('ONLINE');
  }
  try {
    return new NetInfoNetworkMonitor();
  } catch {
    return new MockNetworkMonitor('UNKNOWN');
  }
}
