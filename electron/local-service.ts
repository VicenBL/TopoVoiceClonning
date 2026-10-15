import { createServer, type Server, type ServerResponse } from 'node:http';

import {
  LOOPBACK_HOST,
  type ServiceDiagnostic,
  type ServiceFailure,
  type ServiceSnapshot,
  type ServiceStatus,
} from './service-contract.ts';

interface LocalHttpServiceOptions {
  port: number;
  now?: () => Date;
}

type StateListener = (snapshot: ServiceSnapshot) => void;

export class LocalHttpService {
  private readonly now: () => Date;
  private requestedPort: number;
  private activePort?: number;
  private status: ServiceStatus = 'stopped';
  private startedAt?: string;
  private lastError?: ServiceFailure;
  private server?: Server;
  private startOperation?: Promise<ServiceSnapshot>;
  private stopOperation?: Promise<ServiceSnapshot>;
  private readonly diagnostics: ServiceDiagnostic[] = [];
  private readonly listeners = new Set<StateListener>();

  constructor({ port, now = () => new Date() }: LocalHttpServiceOptions) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new TypeError('Puerto del servicio no válido.');
    }
    this.requestedPort = port;
    this.now = now;
  }

  getState(): ServiceSnapshot {
    return {
      status: this.status,
      host: LOOPBACK_HOST,
      port: this.activePort ?? this.requestedPort,
      ...(this.startedAt ? { startedAt: this.startedAt } : {}),
      ...(this.lastError ? { lastError: { ...this.lastError } } : {}),
    };
  }

  getDiagnostics(): ServiceDiagnostic[] {
    return this.diagnostics.map(diagnostic => ({ ...diagnostic }));
  }

  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<ServiceSnapshot> {
    if (this.status === 'active') return this.getState();
    if (this.startOperation) return this.startOperation;
    if (this.stopOperation) await this.stopOperation;

    this.startOperation = this.openServer();
    try {
      return await this.startOperation;
    } finally {
      this.startOperation = undefined;
    }
  }

  async stop(): Promise<ServiceSnapshot> {
    if (this.stopOperation) return this.stopOperation;
    if (this.startOperation) await this.startOperation;
    if (!this.server?.listening) {
      this.server = undefined;
      this.activePort = undefined;
      this.startedAt = undefined;
      if (this.status !== 'stopped') this.transition('stopped');
      return this.getState();
    }

    this.stopOperation = this.closeServer();
    try {
      return await this.stopOperation;
    } finally {
      this.stopOperation = undefined;
    }
  }

  async restart(port = this.requestedPort): Promise<ServiceSnapshot> {
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new TypeError('Puerto del servicio no válido.');
    }
    await this.stop();
    this.requestedPort = port;
    return this.start();
  }

  private openServer(): Promise<ServiceSnapshot> {
    this.lastError = undefined;
    this.transition('starting');

    return new Promise(resolve => {
      const server = createServer((request, response) => this.handleRequest(request.method, request.url, response));
      this.server = server;

      const onStartupError = (error: NodeJS.ErrnoException) => {
        server.removeListener('listening', onListening);
        this.server = undefined;
        this.activePort = undefined;
        this.startedAt = undefined;
        this.recordFailure(error);
        this.transition('error');
        resolve(this.getState());
      };

      const onListening = () => {
        server.removeListener('error', onStartupError);
        const address = server.address();
        if (!address || typeof address === 'string') {
          onStartupError(Object.assign(new Error('Dirección inesperada del servidor.'), { code: 'INVALID_ADDRESS' }));
          return;
        }
        this.activePort = address.port;
        this.startedAt = this.now().toISOString();
        server.on('error', error => this.handleRuntimeError(error as NodeJS.ErrnoException));
        this.transition('active');
        resolve(this.getState());
      };

      server.once('error', onStartupError);
      server.once('listening', onListening);
      server.listen(this.requestedPort, LOOPBACK_HOST);
    });
  }

  private closeServer(): Promise<ServiceSnapshot> {
    this.transition('stopping');
    const server = this.server!;

    return new Promise(resolve => {
      server.close(error => {
        this.server = undefined;
        this.activePort = undefined;
        this.startedAt = undefined;
        if (error) {
          this.recordFailure(Object.assign(error, { code: 'STOP_FAILED' }));
          this.transition('error');
        } else {
          this.transition('stopped');
        }
        resolve(this.getState());
      });
    });
  }

  private handleRequest(method: string | undefined, url: string | undefined, response: ServerResponse): void {
    if (method !== 'GET') {
      this.sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }
    if (url !== '/health') {
      this.sendJson(response, 404, { error: 'not_found' });
      return;
    }

    const snapshot = this.getState();
    this.sendJson(response, 200, {
      status: 'ok',
      service: 'voice-studio',
      version: 1,
      host: LOOPBACK_HOST,
      port: snapshot.port,
      pid: process.pid,
      startedAt: snapshot.startedAt,
    });
  }

  private sendJson(response: ServerResponse, statusCode: number, body: object): void {
    response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
  }

  private handleRuntimeError(error: NodeJS.ErrnoException): void {
    this.recordFailure(error);
    this.transition('error');
  }

  private recordFailure(error: NodeJS.ErrnoException): void {
    const portInUse = error.code === 'EADDRINUSE';
    const failure: ServiceFailure = {
      code: portInUse ? 'PORT_IN_USE' : (error.code ?? 'SERVICE_ERROR'),
      summary: portInUse ? `El puerto ${this.requestedPort} ya está en uso.` : 'El servicio local encontró un error.',
      detail: portInUse
        ? `No se pudo iniciar Voice Studio en ${LOOPBACK_HOST}:${this.requestedPort}.`
        : error.message,
      at: this.now().toISOString(),
      host: LOOPBACK_HOST,
      port: this.requestedPort,
    };
    this.lastError = failure;
    this.diagnostics.unshift({ id: crypto.randomUUID(), ...failure });
    this.diagnostics.splice(50);
  }

  private transition(status: ServiceStatus): void {
    this.status = status;
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }
}
