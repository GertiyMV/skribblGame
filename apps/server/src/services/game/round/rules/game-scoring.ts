import type { Score } from '@skribbl/shared';

const getRoundProgress = (remainingTimeSec: number, roundTimeSec: number): number =>
  Math.min(1, Math.max(0, (roundTimeSec - remainingTimeSec) / roundTimeSec));

const getGuesserTimeFactor = (progress: number): number => {
  if (progress < 0.25) {
    return 1;
  }
  if (progress < 0.5) {
    return 0.8;
  }
  if (progress < 0.75) {
    return 0.6;
  }
  return 0.4;
};

const getGuesserPositionBonus = (position: number): number => {
  if (position <= 1) {
    return 1;
  }
  if (position === 2) {
    return 0.9;
  }
  if (position === 3) {
    return 0.8;
  }
  return 0.7;
};

/**
 * Вычисляет очки для игрока, который угадал слово.
 */
export const calculateGuesserScore = (
  remainingTimeSec: number,
  roundTimeSec: number,
  hintsUsed: number,
  position: number,
): Score => {
  const progress = getRoundProgress(remainingTimeSec, roundTimeSec);
  const timeFactor = getGuesserTimeFactor(progress);
  const hintPenaltyFactor = Math.max(0, 1 - 0.05 * hintsUsed);
  const positionBonus = getGuesserPositionBonus(position);

  return Math.min(
    100,
    Math.max(5, Math.round(100 * timeFactor * hintPenaltyFactor * positionBonus)),
  );
};

/**
 * Вычисляет очки, начисляемые ведущему за каждое правильное угадывание.
 */
export const calculateLeaderContribution = (
  remainingTimeSec: number,
  roundTimeSec: number,
  roundParticipantsCount: number,
): Score => {
  const progress = getRoundProgress(remainingTimeSec, roundTimeSec);
  const timeFactor = progress < 1 / 3 ? 1 : progress < 2 / 3 ? 0.7 : 0.5;
  const leaderPerGuess = 100 / Math.max(1, roundParticipantsCount);

  return Math.round(leaderPerGuess * timeFactor);
};
