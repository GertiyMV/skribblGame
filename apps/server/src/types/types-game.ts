import type { GameState, Word } from '@skribbl/shared';

export type RoomState = GameState & {
  word: Word;
  roundParticipantsCount: number;
};
