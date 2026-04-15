import { ROUND_TIME_OPTIONS_SEC } from './constants.js';

export type RoomId = string;
export type PlayerId = string;
export type Nickname = string;
export type StrokeId = string;
export type MessageId = string;
export type Word = string;
export type HexColor = string;
export type ReconnectToken = string;
export type EventId = string;
export type IsoTimestamp = string;
export type Score = number;
export type BrushSize = number;

export type ConnectionStatus = 'connected' | 'disconnected';
export type PlayerRole = 'guessing' | 'drawing' | 'spectator';
export type RoundTimeSec = (typeof ROUND_TIME_OPTIONS_SEC)[number];

export type Player = {
  id: PlayerId;
  nickname: Nickname;
  score: Score;
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
  roomId: RoomId;
  phase: GamePhase;
  roundPhase: RoundPhase;
  miniRoundNumber: number;
  totalMiniRounds: number;
  leaderPlayerId: PlayerId;
  roundEndAt: IsoTimestamp;
  wordOptions: Word[];
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
  roomId: RoomId;
  playerId: PlayerId;
  strokeId: StrokeId;
  tool: DrawTool;
  color: HexColor;
  size: BrushSize;
  points: DrawPoint[];
  isFinal: boolean;
};

export type ChatMessageType = 'player' | 'system' | 'hint' | 'guess_result';

export type Message = {
  id: MessageId;
  roomId: RoomId;
  playerId: PlayerId | null;
  type: ChatMessageType;
  text: string;
  createdAt: IsoTimestamp;
};
