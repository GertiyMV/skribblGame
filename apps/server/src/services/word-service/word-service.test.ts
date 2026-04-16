import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WordService } from './word-service.js';

const toLetters = (value: number): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  let n = value;
  let result = '';
  do {
    result = alphabet[n % alphabet.length] + result;
    n = Math.floor(n / alphabet.length);
  } while (n > 0);
  return result;
};

const makeWords = (prefix: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}${toLetters(index)}`);

describe('WordService', () => {
  it('загружает ru словарь с минимум 250 слов на каждый уровень сложности', () => {
    const service = new WordService();

    assert.ok(service.getWordCount('medium') >= 250);
    assert.ok(service.getWordCount('hard') >= 250);
  });

  it('возвращает уникальные word options только для выбранной сложности', () => {
    const service = new WordService();

    const options = service.getWordOptions(5, 'hard');
    const hardOptions = new Set(service.getWordOptions(service.getWordCount('hard'), 'hard'));

    assert.equal(options.length, 5);
    assert.equal(new Set(options).size, options.length);
    assert.ok(options.every((word) => hardOptions.has(word)));
  });

  it('бросает ошибку при дубликатах после нормализации', () => {
    const mediumWords = makeWords('книга', 248);
    const hardWords = makeWords('лампа', 250);

    assert.throws(
      () =>
        new WordService({
          dictionaryData: {
            medium: [' КОТ ', 'кот', ...mediumWords],
            hard: hardWords,
          },
        }),
      /Duplicate word detected/,
    );
  });

  it('бросает ошибку при близких формах слова', () => {
    const mediumWords = makeWords('книга', 248);
    const hardWords = makeWords('лампа', 250);

    assert.throws(
      () =>
        new WordService({
          dictionaryData: {
            medium: ['машина', 'машинаа', ...mediumWords],
            hard: hardWords,
          },
        }),
      /Near-duplicate word forms detected/,
    );
  });

  it('бросает ошибку, если на уровне сложности меньше 250 слов', () => {
    assert.throws(
      () =>
        new WordService({
          dictionaryData: {
            medium: makeWords('книга', 249),
            hard: makeWords('лампа', 250),
          },
        }),
      /must contain at least 250 words/,
    );
  });
});
