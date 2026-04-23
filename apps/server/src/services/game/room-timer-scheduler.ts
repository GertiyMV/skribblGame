import { clearTimeout, setTimeout } from 'node:timers';

import { ROUND_END_DURATION_MS, WORD_SELECTION_DURATION_MS, type RoomId } from '@skribbl/shared';

type TimerHandle = ReturnType<typeof setTimeout>;
export type SetTimeoutFn = (callback: () => void, ms: number) => TimerHandle;
export type ClearTimeoutFn = (handle: TimerHandle) => void;

interface RoomTimerState {
  wordSelectionTimer: TimerHandle | null;
  drawingTimer: TimerHandle | null;
  roundEndTimer: TimerHandle | null;
  hintTimers: TimerHandle[];
}

/**
 * Stores and manages all timers scheduled for a room.
 */
export class RoomTimerScheduler {
  private readonly roomTimers = new Map<RoomId, RoomTimerState>();
  private readonly scheduleTimer: SetTimeoutFn;
  private readonly cancelTimer: ClearTimeoutFn;

  constructor(timerFns: { setTimeout?: SetTimeoutFn; clearTimeout?: ClearTimeoutFn } = {}) {
    this.scheduleTimer = timerFns.setTimeout ?? setTimeout;
    this.cancelTimer = timerFns.clearTimeout ?? clearTimeout;
  }

  clearRoomTimers(roomId: RoomId): void {
    const timers = this.roomTimers.get(roomId);
    if (!timers) {
      return;
    }

    if (timers.wordSelectionTimer) {
      this.cancelTimer(timers.wordSelectionTimer);
    }
    if (timers.drawingTimer) {
      this.cancelTimer(timers.drawingTimer);
    }
    if (timers.roundEndTimer) {
      this.cancelTimer(timers.roundEndTimer);
    }
    for (const handle of timers.hintTimers) {
      this.cancelTimer(handle);
    }

    this.roomTimers.delete(roomId);
  }

  clearHintTimers(roomId: RoomId): void {
    const timers = this.getOrCreateRoomTimers(roomId);
    for (const handle of timers.hintTimers) {
      this.cancelTimer(handle);
    }
    timers.hintTimers = [];
  }

  cancelWordSelectionTimeout(roomId: RoomId): void {
    const timers = this.getOrCreateRoomTimers(roomId);
    if (!timers.wordSelectionTimer) {
      return;
    }

    this.cancelTimer(timers.wordSelectionTimer);
    timers.wordSelectionTimer = null;
  }

  cancelDrawingTimeout(roomId: RoomId): void {
    const timers = this.getOrCreateRoomTimers(roomId);
    if (!timers.drawingTimer) {
      return;
    }

    this.cancelTimer(timers.drawingTimer);
    timers.drawingTimer = null;
  }

  scheduleWordSelectionTimeout(roomId: RoomId, onTimeout: () => void): void {
    const timers = this.getOrCreateRoomTimers(roomId);
    if (timers.wordSelectionTimer) {
      this.cancelTimer(timers.wordSelectionTimer);
    }

    timers.wordSelectionTimer = this.scheduleTimer(onTimeout, WORD_SELECTION_DURATION_MS);
  }

  scheduleDrawingTimeout(roomId: RoomId, roundTimeSec: number, onTimeout: () => void): void {
    const timers = this.getOrCreateRoomTimers(roomId);
    if (timers.drawingTimer) {
      this.cancelTimer(timers.drawingTimer);
    }

    timers.drawingTimer = this.scheduleTimer(onTimeout, roundTimeSec * 1000);
  }

  scheduleRoundEndTimeout(roomId: RoomId, onTimeout: () => void): void {
    const timers = this.getOrCreateRoomTimers(roomId);
    if (timers.roundEndTimer) {
      this.cancelTimer(timers.roundEndTimer);
    }

    timers.roundEndTimer = this.scheduleTimer(onTimeout, ROUND_END_DURATION_MS);
  }

  scheduleHintTimers(
    roomId: RoomId,
    roundTimeSec: number,
    hintsTotal: number,
    onTimeout: () => void,
  ): void {
    const timers = this.getOrCreateRoomTimers(roomId);
    this.clearHintTimers(roomId);

    for (let i = 0; i < hintsTotal; i += 1) {
      const delayMs = Math.floor(((i + 1) / (hintsTotal + 1)) * roundTimeSec * 1000);
      const handle = this.scheduleTimer(onTimeout, delayMs);
      timers.hintTimers.push(handle);
    }
  }

  private getOrCreateRoomTimers(roomId: RoomId): RoomTimerState {
    let timers = this.roomTimers.get(roomId);
    if (!timers) {
      timers = {
        wordSelectionTimer: null,
        drawingTimer: null,
        roundEndTimer: null,
        hintTimers: [],
      };
      this.roomTimers.set(roomId, timers);
    }
    return timers;
  }
}
