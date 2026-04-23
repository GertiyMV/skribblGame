import type { PlayerId, RoomId } from '@skribbl/shared';
import { RECONNECT_TIMEOUT_MS } from '@skribbl/shared';
import { clearTimeout, setTimeout } from 'node:timers';

const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ROOM_EMPTY_TIMEOUT_MS = 60_000;

type TimerHandle = ReturnType<typeof setTimeout>;
type SetTimeoutFn = (callback: () => void, ms: number) => TimerHandle;
type ClearTimeoutFn = (handle: TimerHandle) => void;

interface RoomEntry {
  playerIds: Set<PlayerId>;
  emptyTimer: TimerHandle | null;
}

export class RoomManager {
  private readonly rooms = new Map<RoomId, RoomEntry>();
  private readonly reconnectTimers = new Map<PlayerId, TimerHandle>();
  private readonly onRoomDeleted: (roomId: RoomId) => Promise<void>;
  private readonly onReconnectTimeout: (roomId: RoomId, playerId: PlayerId) => Promise<void>;
  private readonly scheduleTimer: SetTimeoutFn;
  private readonly cancelTimer: ClearTimeoutFn;

  constructor(
    onRoomDeleted: (roomId: RoomId) => Promise<void>,
    onReconnectTimeout: (roomId: RoomId, playerId: PlayerId) => Promise<void>,
    timerFns: { setTimeout?: SetTimeoutFn; clearTimeout?: ClearTimeoutFn } = {},
  ) {
    this.onRoomDeleted = onRoomDeleted;
    this.onReconnectTimeout = onReconnectTimeout;
    this.scheduleTimer = timerFns.setTimeout ?? setTimeout;
    this.cancelTimer = timerFns.clearTimeout ?? clearTimeout;
  }

  createRoom(): RoomId {
    let code: string;

    do {
      code = '';
      for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
        const randomIndex = Math.floor(Math.random() * ROOM_CODE_CHARS.length);
        code += ROOM_CODE_CHARS[randomIndex] ?? ROOM_CODE_CHARS[0];
      }
    } while (this.rooms.has(code));

    this.rooms.set(code, { playerIds: new Set(), emptyTimer: null });
    return code;
  }

  hasRoom(roomId: RoomId): boolean {
    return this.rooms.has(roomId);
  }

  addPlayer(roomId: RoomId, playerId: PlayerId): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    const reconnectTimer = this.reconnectTimers.get(playerId);
    if (reconnectTimer !== undefined) {
      this.cancelTimer(reconnectTimer);
      this.reconnectTimers.delete(playerId);
    }

    if (room.emptyTimer !== null) {
      this.cancelTimer(room.emptyTimer);
      room.emptyTimer = null;
    }

    room.playerIds.add(playerId);
  }

  removePlayer(roomId: RoomId, playerId: PlayerId): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    const timer = this.scheduleTimer(() => {
      this.reconnectTimers.delete(playerId);
      room.playerIds.delete(playerId);

      void this.onReconnectTimeout(roomId, playerId);

      if (room.playerIds.size === 0) {
        room.emptyTimer = this.scheduleTimer(() => {
          this.rooms.delete(roomId);
          void this.onRoomDeleted(roomId);
        }, ROOM_EMPTY_TIMEOUT_MS);
      }
    }, RECONNECT_TIMEOUT_MS);

    this.reconnectTimers.set(playerId, timer);
  }

  deleteRoom(roomId: RoomId): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    for (const playerId of room.playerIds) {
      const timer = this.reconnectTimers.get(playerId);
      if (timer !== undefined) {
        this.cancelTimer(timer);
        this.reconnectTimers.delete(playerId);
      }
    }

    if (room.emptyTimer !== null) {
      this.cancelTimer(room.emptyTimer);
    }

    this.rooms.delete(roomId);
  }
}
