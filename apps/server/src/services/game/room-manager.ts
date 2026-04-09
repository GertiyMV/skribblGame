import { RECONNECT_TIMEOUT_MS } from '@skribbl/shared';
import { clearTimeout, setTimeout } from 'node:timers';

const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ROOM_EMPTY_TIMEOUT_MS = 60_000;

interface RoomEntry {
  playerIds: Set<string>;
  emptyTimer: ReturnType<typeof setTimeout> | null;
}

export class RoomManager {
  private readonly rooms = new Map<string, RoomEntry>();
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly onRoomDeleted: (roomId: string) => Promise<void>;
  private readonly onReconnectTimeout: (roomId: string, playerId: string) => Promise<void>;

  constructor(
    onRoomDeleted: (roomId: string) => Promise<void>,
    onReconnectTimeout: (roomId: string, playerId: string) => Promise<void>,
  ) {
    this.onRoomDeleted = onRoomDeleted;
    this.onReconnectTimeout = onReconnectTimeout;
  }

  createRoom(): string {
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

  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  addPlayer(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    const reconnectTimer = this.reconnectTimers.get(playerId);
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      this.reconnectTimers.delete(playerId);
    }

    if (room.emptyTimer !== null) {
      clearTimeout(room.emptyTimer);
      room.emptyTimer = null;
    }

    room.playerIds.add(playerId);
  }

  removePlayer(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(playerId);
      room.playerIds.delete(playerId);

      void this.onReconnectTimeout(roomId, playerId);

      if (room.playerIds.size === 0) {
        room.emptyTimer = setTimeout(() => {
          this.rooms.delete(roomId);
          void this.onRoomDeleted(roomId);
        }, ROOM_EMPTY_TIMEOUT_MS).unref();
      }
    }, RECONNECT_TIMEOUT_MS).unref();

    this.reconnectTimers.set(playerId, timer);
  }

  deleteRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    for (const playerId of room.playerIds) {
      const timer = this.reconnectTimers.get(playerId);
      if (timer !== undefined) {
        clearTimeout(timer);
        this.reconnectTimers.delete(playerId);
      }
    }

    if (room.emptyTimer !== null) {
      clearTimeout(room.emptyTimer);
    }

    this.rooms.delete(roomId);
  }
}
