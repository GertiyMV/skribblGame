import {
  GamePhase,
  ROUND_END_DURATION_MS,
  RoundPhase,
  WORD_SELECTION_DURATION_MS,
  type Word,
} from '@skribbl/shared';

import type { RoomState } from '../../../../types/types-game.js';
import { buildDrawingState } from './game-state-helpers.js';
import type { GameEngineContext } from '../../engine/game-engine-context.js';
import { getNextLeaderPlayerId } from './game-state-helpers.js';
import { makeMask } from '../rules/word-mask.js';

/**
 * Формирует первое состояние выбора слова при старте игры.
 */
export const createWordSelectionState = (
  context: GameEngineContext,
  state: RoomState,
): RoomState => {
  const selectionDeadline = new Date(Date.now() + WORD_SELECTION_DURATION_MS).toISOString();

  return {
    ...state,
    phase: GamePhase.InGame,
    roundPhase: RoundPhase.WordSelection,
    miniRoundNumber: state.miniRoundNumber === 0 ? 1 : state.miniRoundNumber,
    roundEndAt: selectionDeadline,
    wordOptions: context.wordService.getWordOptions(
      state.settings.wordChoicesCount,
      state.settings.wordDifficulty,
      [],
    ),
    usedWords: [],
    wordMask: '',
    wordLength: 0,
    hintsUsed: 0,
    players: state.players.map((player) => ({
      ...player,
      guessed: false,
      role: player.id === state.leaderPlayerId ? 'drawing' : 'guessing',
    })),
  };
};

/**
 * Формирует состояние фазы рисования для выбранного слова.
 */
export const createDrawingState = (state: RoomState, chosenWord: Word): RoomState => {
  const roundEndAt = new Date(Date.now() + state.settings.roundTimeSec * 1000).toISOString();

  return {
    ...buildDrawingState(state),
    phase: GamePhase.InGame,
    roundPhase: RoundPhase.Drawing,
    roundEndAt,
    word: chosenWord,
    usedWords: [...(state.usedWords ?? []), chosenWord],
    wordOptions: [],
    wordMask: makeMask(chosenWord),
    wordLength: Array.from(chosenWord).length,
    hintsUsed: 0,
    roundParticipantsCount: state.players.filter(
      (player) => player.connectionStatus === 'connected',
    ).length,
  };
};

/**
 * Формирует следующее состояние выбора слова после завершения раунда.
 */
export const createNextWordSelectionState = (
  context: GameEngineContext,
  state: RoomState,
): RoomState => {
  const selectionDeadline = new Date(Date.now() + WORD_SELECTION_DURATION_MS).toISOString();

  return {
    ...state,
    phase: GamePhase.InGame,
    roundPhase: RoundPhase.WordSelection,
    miniRoundNumber: state.miniRoundNumber + 1,
    roundEndAt: selectionDeadline,
    wordOptions: context.wordService.getWordOptions(
      state.settings.wordChoicesCount,
      state.settings.wordDifficulty,
      state.usedWords ?? [],
    ),
    wordMask: '',
    wordLength: 0,
    hintsUsed: 0,
  };
};

/**
 * Применяет общий переход в RoundEnd перед отправкой событий.
 */
export const createRoundEndState = (
  state: RoomState,
): {
  roundEndState: RoomState;
  nextLeaderPlayerId: string;
} => {
  const nextLeaderPlayerId = getNextLeaderPlayerId(state);
  const roundEndAt = new Date(Date.now() + ROUND_END_DURATION_MS).toISOString();

  return {
    nextLeaderPlayerId,
    roundEndState: {
      ...state,
      roundPhase: RoundPhase.RoundEnd,
      roundEndAt,
      leaderPlayerId: nextLeaderPlayerId,
      players: state.players.map((player) => ({
        ...player,
        role: player.id === nextLeaderPlayerId ? 'drawing' : 'guessing',
      })),
    },
  };
};

/**
 * Формирует финальное состояние завершения игры.
 */
export const createGameOverState = (state: RoomState): RoomState => ({
  ...state,
  phase: GamePhase.GameOver,
  roundPhase: RoundPhase.RoundEnd,
});
