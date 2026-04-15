import {
  RECONNECT_MAX_ATTEMPTS,
  type ClientToServerEventPayloads,
  type ClientToServerEvents,
  type ReconnectToken,
  type ServerToClientEventPayloads,
  type ServerToClientEvents,
} from '@skribbl/shared';
import { io, type Socket } from 'socket.io-client';
import { getReconnectDelayMs } from './reconnect-policy.js';

type JoinPayload = ClientToServerEventPayloads['join_room'];

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'failed';

const globalSetTimeout = globalThis.setTimeout.bind(globalThis);
const globalClearTimeout = globalThis.clearTimeout.bind(globalThis);

export type GameSocketClientOptions = {
  serverUrl: string;
  namespace?: string;
  maxReconnectAttempts?: number;
  onSessionReady?: (payload: ServerToClientEventPayloads['session_ready']) => void;
  onReconnectFailed?: () => void;
};

export class GameSocketClient {
  private readonly socket: GameSocket;

  private readonly maxReconnectAttempts: number;

  private readonly onSessionReady?: (payload: ServerToClientEventPayloads['session_ready']) => void;

  private readonly onReconnectFailed?: () => void;

  private reconnectAttempts = 0;

  private reconnectTimer: ReturnType<typeof globalSetTimeout> | null = null;

  private state: ConnectionState = 'idle';

  private pendingJoinPayload: JoinPayload | null = null;

  private reconnectToken: ReconnectToken | null = null;

  public constructor(options: GameSocketClientOptions) {
    const namespace = options.namespace ?? '/game';
    const maxReconnectAttempts = options.maxReconnectAttempts ?? RECONNECT_MAX_ATTEMPTS;

    this.socket = io(`${options.serverUrl}${namespace}`, {
      autoConnect: false,
      reconnection: false,
      transports: ['websocket'],
    });
    this.maxReconnectAttempts = maxReconnectAttempts;
    this.onSessionReady = options.onSessionReady;
    this.onReconnectFailed = options.onReconnectFailed;

    this.bindCoreListeners();
  }

  public connectAndJoin(payload: JoinPayload): void {
    this.pendingJoinPayload = payload;
    this.state = 'connecting';
    this.socket.connect();
  }

  public disconnect(): void {
    this.clearReconnectTimer();
    this.pendingJoinPayload = null;
    this.state = 'idle';
    this.socket.disconnect();
  }

  public getState(): ConnectionState {
    return this.state;
  }

  private bindCoreListeners(): void {
    this.socket.on('connect', () => {
      this.state = 'connected';
      this.reconnectAttempts = 0;

      if (!this.pendingJoinPayload) {
        return;
      }

      const reconnectToken = this.reconnectToken ?? this.pendingJoinPayload.reconnectToken;
      this.socket.emit('join_room', {
        ...this.pendingJoinPayload,
        reconnectToken,
      });
    });

    this.socket.on('session_ready', (payload) => {
      this.reconnectToken = payload.reconnectToken;
      this.onSessionReady?.(payload);
    });

    this.socket.on('disconnect', (reason) => {
      this.state = 'idle';
      if (!this.pendingJoinPayload || reason === 'io client disconnect') {
        return;
      }

      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.state = 'failed';
      this.onReconnectFailed?.();
      return;
    }

    this.reconnectAttempts += 1;
    const delayMs = getReconnectDelayMs(this.reconnectAttempts);

    this.clearReconnectTimer();
    this.reconnectTimer = globalSetTimeout(() => {
      this.state = 'connecting';
      this.socket.connect();
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }

    globalClearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
