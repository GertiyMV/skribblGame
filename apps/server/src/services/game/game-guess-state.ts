import type { PlayerId, Score } from '@skribbl/shared';

import type { RoomState } from '../../types/types-game.js';
import { calculateGuesserScore, calculateLeaderContribution } from './game-scoring.js';

interface GuessScoringResult {
  awardedScore: Score;
  position: number;
  updatedState: RoomState;
}

/**
 * Применяет изменения очков за правильную попытку и возвращает обновлённое состояние раунда.
 */
export const applyCorrectGuess = (
  state: RoomState,
  playerId: PlayerId,
  nowMs: number = Date.now(),
): GuessScoringResult => {
  const correctGuessersBeforeThis = state.players.filter(
    (player) => player.guessed && player.id !== state.leaderPlayerId,
  );
  const position = correctGuessersBeforeThis.length + 1;

  const roundEndTimestamp = new Date(state.roundEndAt).getTime();
  const remainingTimeSec = Math.max(0, (roundEndTimestamp - nowMs) / 1000);
  const awardedScore = calculateGuesserScore(
    remainingTimeSec,
    state.settings.roundTimeSec,
    state.hintsUsed,
    position,
  );
  const leaderContribution = calculateLeaderContribution(
    remainingTimeSec,
    state.settings.roundTimeSec,
    state.roundParticipantsCount,
  );

  return {
    awardedScore,
    position,
    updatedState: {
      ...state,
      players: state.players.map((player) =>
        player.id === playerId
          ? { ...player, score: player.score + awardedScore, guessed: true }
          : player.id === state.leaderPlayerId
            ? { ...player, score: player.score + leaderContribution }
            : player,
      ),
    },
  };
};

/**
 * Возвращает true, когда каждый подключённый угадывающий уже угадал слово.
 */
export const areAllGuessersFinished = (state: RoomState): boolean => {
  const guessers = state.players.filter(
    (player) => player.id !== state.leaderPlayerId && player.connectionStatus === 'connected',
  );

  return guessers.length > 0 && guessers.every((player) => player.guessed);
};
