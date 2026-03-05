import { ROUND_TIME_OPTIONS_SEC } from './constants.js';

export type ConnectionStatus = 'connected' | 'disconnected';

export type PlayerRole = 'guessing' | 'drawing' | 'spectator';

export type RoundTimeSec = (typeof ROUND_TIME_OPTIONS_SEC)[number];

export type Player = {
  id: string;
  nickname: string;
  score: number;
  isOwner: boolean;
  guessed: boolean;
  connectionStatus: ConnectionStatus;
  role: PlayerRole;
};

export type RoomSettings = {
  maxPlayers: number;
  roundTimeSec: RoundTimeSec;
  roundsCount: number;
  wordChoicesCount: number;
  hintsCount: number;
  language: 'ru';
  customWords?: string[];
  useCustomWordsOnly: boolean;
};

export enum GamePhase {
  Lobby = 'lobby',
  InGame = 'in_game',
  GameOver = 'game_over',
}

export enum RoundPhase {
  WordSelection = 'word_selection',
  Drawing = 'drawing',
  RoundEnd = 'round_end',
}

export type GameState = {
  roomId: string;
  phase: GamePhase;
  roundPhase: RoundPhase;
  miniRoundNumber: number;
  totalMiniRounds: number;
  leaderPlayerId: string;
  roundEndAt: string;
  wordMask: string;
  wordLength: number;
  hintsUsed: number;
  hintsTotal: number;
  players: Player[];
  settings: RoomSettings;
};

export type DrawPoint = {
  x: number;
  y: number;
  t: number;
};

export type DrawTool = 'brush' | 'eraser' | 'fill' | 'clear';

export type DrawEvent = {
  roomId: string;
  playerId: string;
  strokeId: string;
  tool: DrawTool;
  color: string;
  size: number;
  points: DrawPoint[];
  isFinal: boolean;
};

export type ChatMessageType = 'player' | 'system' | 'hint' | 'guess_result';

export type Message = {
  id: string;
  roomId: string;
  playerId: string | null;
  type: ChatMessageType;
  text: string;
  createdAt: string;
};
