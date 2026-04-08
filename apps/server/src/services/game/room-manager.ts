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
  private readonly onRoomDeleted: (roomId: string) => Promise<void>;

  constructor(onRoomDeleted: (roomId: string) => Promise<void>) {
    this.onRoomDeleted = onRoomDeleted;
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

    room.playerIds.delete(playerId);

    if (room.playerIds.size === 0) {
      room.emptyTimer = setTimeout(() => {
        this.rooms.delete(roomId);
        void this.onRoomDeleted(roomId);
      }, ROOM_EMPTY_TIMEOUT_MS).unref();
    }
  }

  deleteRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    if (room.emptyTimer !== null) {
      clearTimeout(room.emptyTimer);
    }

    this.rooms.delete(roomId);
  }
}
