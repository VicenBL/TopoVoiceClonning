/// <reference types="vite/client" />

import type { MediaBridge } from '../electron/media-contract';
import type { ServiceBridge } from '../electron/service-contract';

declare global {
  interface Window {
    voiceStudio?: { service: ServiceBridge; media: MediaBridge };
  }
}

export {};
