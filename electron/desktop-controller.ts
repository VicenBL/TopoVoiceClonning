import { LocalHttpService } from './local-service.ts';
import {
  type ServiceDiagnostic,
  type ServicePreferences,
  type ServiceSnapshot,
  validateServicePreferences,
} from './service-contract.ts';

export type CloseAction = 'hide' | 'quit' | 'allow';

export function resolveCloseAction(keepRunningOnClose: boolean, quitting: boolean): CloseAction {
  if (quitting) return 'allow';
  return keepRunningOnClose ? 'hide' : 'quit';
}

export class DesktopServiceController {
  private preferences: ServicePreferences;
  private readonly service: LocalHttpService;

  constructor(initialPreferences: ServicePreferences) {
    this.preferences = validateServicePreferences(initialPreferences);
    this.service = new LocalHttpService({ port: this.preferences.port });
  }

  getPreferences(): ServicePreferences {
    return { ...this.preferences };
  }

  getState(): ServiceSnapshot {
    return this.service.getState();
  }

  getDiagnostics(): ServiceDiagnostic[] {
    return this.service.getDiagnostics();
  }

  onStateChange(listener: (snapshot: ServiceSnapshot) => void): () => void {
    return this.service.onStateChange(listener);
  }

  async configure(value: unknown): Promise<ServiceSnapshot> {
    const next = validateServicePreferences(value);
    const previous = this.preferences;
    const portChanged = next.port !== previous.port;

    if (portChanged) {
      const status = this.service.getState().status;
      if (status === 'active' || status === 'starting' || status === 'stopping') {
        await this.service.restart(next.port);
      } else {
        this.service.configurePort(next.port);
      }
    }

    this.preferences = next;
    const current = this.service.getState();
    if (next.autoStart && (current.status === 'stopped' || current.status === 'error')) {
      return this.service.start();
    }
    return current;
  }

  start(): Promise<ServiceSnapshot> {
    return this.service.start();
  }

  stop(): Promise<ServiceSnapshot> {
    return this.service.stop();
  }

  restart(): Promise<ServiceSnapshot> {
    return this.service.restart(this.preferences.port);
  }

  shutdown(): Promise<ServiceSnapshot> {
    return this.service.stop();
  }
}
