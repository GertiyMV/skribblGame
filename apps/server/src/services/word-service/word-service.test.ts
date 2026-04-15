import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WordService } from './word-service.js';

describe('WordService', () => {
  it('загружает ru словарь с минимум 200 слов', () => {
    const service = new WordService();

    assert.ok(service.getWordCount() >= 200);
  });

  it('возвращает уникальные word options в заданном количестве', () => {
    const service = new WordService();

    const options = service.getWordOptions(5);

    assert.equal(options.length, 5);
    assert.equal(new Set(options).size, options.length);
  });

  it('бросает ошибку при дубликатах после нормализации', () => {
    assert.throws(
      () =>
        new WordService({
          dictionaryData: {
            easy: [' КОТ ', 'кот'],
            medium: ['велосипед'],
            hard: ['параллелепипед'],
          },
        }),
      /Duplicate word detected/,
    );
  });

  it('бросает ошибку при близких формах слова', () => {
    assert.throws(
      () =>
        new WordService({
          dictionaryData: {
            easy: ['машина', 'машинаа'],
            medium: ['алгоритм'],
            hard: ['архитектура'],
          },
        }),
      /Near-duplicate word forms detected/,
    );
  });
});
