import type { PlayerId } from '@skribbl/shared';

import type { RoomState } from '../../types/types-game.js';

/**
 * Resets per-round player flags while keeping the current leader.
 */
export const buildDrawingState = (state: RoomState): RoomState => ({
  ...state,
  players: state.players.map((player) => ({
    ...player,
    guessed: false,
    role: player.id === state.leaderPlayerId ? 'drawing' : 'guessing',
  })),
});

/**
 * Returns the player entry for the provided id.
 */
export const getCurrentPlayer = (state: RoomState, playerId: PlayerId) =>
  state.players.find((player) => player.id === playerId);

/**
 * Picks the next connected player to become the round leader.
 */
export const getNextLeaderPlayerId = (state: RoomState): PlayerId => {
  const currentIndex = state.players.findIndex((player) => player.id === state.leaderPlayerId);
  if (currentIndex < 0 || state.players.length === 0) {
    return state.leaderPlayerId;
  }

  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const index = (currentIndex + offset) % state.players.length;
    const candidate = state.players[index];
    if (candidate && candidate.connectionStatus === 'connected') {
      return candidate.id;
    }
  }

  return state.leaderPlayerId;
};

/**
 * Returns all winner ids for the final scoreboard.
 */
export const getWinners = (state: RoomState): PlayerId[] => {
  const maxScore = Math.max(...state.players.map((player) => player.score));
  return state.players.filter((player) => player.score === maxScore).map((player) => player.id);
};

/**
 * Picks a random item from a readonly array.
 */
export const pickRandom = <T>(array: readonly T[]): T | undefined =>
  array[Math.floor(Math.random() * array.length)];
