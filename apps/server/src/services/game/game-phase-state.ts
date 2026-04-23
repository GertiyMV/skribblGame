import {
  GamePhase,
  ROUND_END_DURATION_MS,
  RoundPhase,
  WORD_SELECTION_DURATION_MS,
  type Word,
} from '@skribbl/shared';

import type { RoomState } from '../../types/types-game.js';
import { buildDrawingState } from './game-state-helpers.js';
import type { GameEngineContext } from './game-engine-context.js';
import { getNextLeaderPlayerId } from './game-state-helpers.js';
import { makeMask } from './word-mask.js';

/**
 * Builds the first word-selection state when the game starts.
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
 * Builds a drawing-phase state for the chosen word.
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
 * Builds the next word-selection state after round end.
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
 * Applies the shared RoundEnd transition before emitting events.
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
 * Creates the final game-over state.
 */
export const createGameOverState = (state: RoomState): RoomState => ({
  ...state,
  phase: GamePhase.GameOver,
  roundPhase: RoundPhase.RoundEnd,
});
