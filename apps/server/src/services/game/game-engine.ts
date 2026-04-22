import type { ClientToServerEventPayloads, RoomId } from '@skribbl/shared';
import type { RedisClientType } from 'redis';

import type { GameNamespace, GameSocket, RoomEmitterTarget } from '../../types/types-socket.js';
import { WordService } from '../word-service/word-service.js';
import type { GameEngineContext } from './game-engine-context.js';
import { handleGuess as handleGuessFlow, handleHintTimeout } from './game-guess-flow.js';
import {
  handleChooseWord as handleChooseWordFlow,
  handleDrawingTimeout,
  handleRoundEndTimeout,
  handleStartGame as handleStartGameFlow,
  handleWordSelectionTimeout,
} from './game-start-flow.js';
import {
  RoomTimerScheduler,
  type ClearTimeoutFn,
  type SetTimeoutFn,
} from './room-timer-scheduler.js';

export class GameEngine {
  private readonly context: GameEngineContext;

  constructor(
    redis: RedisClientType,
    roomEmitterTarget: RoomEmitterTarget,
    timerFns: {
      setTimeout?: SetTimeoutFn;
      clearTimeout?: ClearTimeoutFn;
      namespace?: GameNamespace;
      wordService?: WordService;
    } = {},
  ) {
    this.context = {
      redis,
      roomEmitterTarget,
      roomTimers: new RoomTimerScheduler({
        setTimeout: timerFns.setTimeout,
        clearTimeout: timerFns.clearTimeout,
      }),
      namespace: timerFns.namespace,
      wordService: timerFns.wordService ?? new WordService(),
    };
  }

  private readonly startDrawingCallbacks = {
    onHintTimeout: (roomId: RoomId, miniRoundNumber: number): void => {
      void this.handleHintTimeout(roomId, miniRoundNumber);
    },
    onDrawingTimeout: (roomId: RoomId, miniRoundNumber: number): void => {
      void this.handleDrawingTimeout(roomId, miniRoundNumber);
    },
  };

  private readonly onWordSelectionTimeout = (roomId: RoomId, miniRoundNumber: number): void => {
    void this.handleWordSelectionTimeout(roomId, miniRoundNumber);
  };

  private readonly onRoundEndTimeout = (roomId: RoomId, miniRoundNumber: number): void => {
    void this.handleRoundEndTimeout(roomId, miniRoundNumber);
  };

  private async handleWordSelectionTimeout(roomId: RoomId, miniRoundNumber: number): Promise<void> {
    await handleWordSelectionTimeout(
      this.context,
      roomId,
      miniRoundNumber,
      this.startDrawingCallbacks,
    );
  }

  private async handleHintTimeout(roomId: RoomId, miniRoundNumber: number): Promise<void> {
    await handleHintTimeout(this.context, roomId, miniRoundNumber);
  }

  private async handleDrawingTimeout(roomId: RoomId, miniRoundNumber: number): Promise<void> {
    await handleDrawingTimeout(this.context, roomId, miniRoundNumber, this.onRoundEndTimeout);
  }

  private async handleRoundEndTimeout(roomId: RoomId, miniRoundNumber: number): Promise<void> {
    await handleRoundEndTimeout(this.context, roomId, miniRoundNumber, this.onWordSelectionTimeout);
  }

  /**
   * Запускает игру и переводит комнату из lobby в in_game/word_selection.
   */
  async handleStartGame(
    socket: GameSocket,
    payload: ClientToServerEventPayloads['start_game'],
  ): Promise<void> {
    await handleStartGameFlow(this.context, socket, payload, this.onWordSelectionTimeout);
  }

  /**
   * Обрабатывает выбор слова ведущим и переводит раунд в drawing.
   */
  async handleChooseWord(
    socket: GameSocket,
    payload: ClientToServerEventPayloads['choose_word'],
  ): Promise<void> {
    await handleChooseWordFlow(this.context, socket, payload, this.startDrawingCallbacks);
  }

  /**
   * Обрабатывает попытку угадать слово.
   */
  async handleGuess(
    socket: GameSocket,
    payload: ClientToServerEventPayloads['guess'],
  ): Promise<void> {
    await handleGuessFlow(this.context, socket, payload, this.onRoundEndTimeout);
  }
}
