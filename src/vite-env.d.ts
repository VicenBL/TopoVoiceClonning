/// <reference types="vite/client" />

import type { ServiceBridge } from '../electron/service-contract';

declare global {
  interface Window {
    voiceStudio?: { service: ServiceBridge };
  }
}

export {};
