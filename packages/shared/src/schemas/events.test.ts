import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DRAW_MAX_POINTS_PER_MESSAGE } from '../constants.js';
import { clientToServerSchemas, serverToClientSchemas } from './events.js';

describe('clientToServerSchemas.create_room', () => {
  it('обрезает nickname и валидирует payload', () => {
    const result = clientToServerSchemas.create_room.safeParse({
      nickname: '  Misha  ',
      settingsOverride: { roundTimeSec: 80, wordChoicesCount: 5, wordDifficulty: 'hard' },
    });

    assert.equal(result.success, true);
    assert.equal(result.data?.nickname, 'Misha');
    assert.equal(result.data?.settingsOverride?.wordChoicesCount, 5);
    assert.equal(result.data?.settingsOverride?.wordDifficulty, 'hard');
  });
});

describe('clientToServerSchemas.join_room', () => {
  it('отклоняет roomId, который не соответствует контракту', () => {
    const result = clientToServerSchemas.join_room.safeParse({
      roomId: 'ab12',
      nickname: 'Alex',
    });

    assert.equal(result.success, false);
  });
});

describe('clientToServerSchemas.draw', () => {
  it('отклоняет payload со слишком большим количеством точек', () => {
    const points = Array.from({ length: DRAW_MAX_POINTS_PER_MESSAGE + 1 }, (_, index) => ({
      x: index,
      y: index + 0.5,
      t: index,
    }));

    const result = clientToServerSchemas.draw.safeParse({
      roomId: 'AB12',
      strokeId: 's_001',
      tool: 'brush',
      color: '#1F2937',
      size: 6,
      points,
      isFinal: false,
    });

    assert.equal(result.success, false);
  });
});

describe('serverToClientSchemas.guess_result', () => {
  it('поддерживает варианты ok=true и ok=false', () => {
    const successResult = serverToClientSchemas.guess_result.safeParse({
      eventId: '5b0f638a-4ca8-4d7d-b4e0-85dfce82442b',
      ts: '2026-03-03T14:30:45.000Z',
      roomId: 'AB12',
      playerId: 'p_07',
      messageId: 'm_7781',
      ok: true,
      result: 'correct',
      awardedScore: 84,
      position: 1,
    });

    const errorResult = serverToClientSchemas.guess_result.safeParse({
      eventId: '58f8bb8e-1889-459e-a47b-03220fa08eeb',
      ts: '2026-03-03T14:30:45.100Z',
      roomId: 'AB12',
      playerId: 'p_07',
      messageId: 'm_7782',
      ok: false,
      error: {
        code: 'rate_limit_exceeded',
        message: 'Too many guess requests',
      },
    });

    assert.equal(successResult.success, true);
    assert.equal(errorResult.success, true);
  });
});
