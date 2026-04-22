import type { Word } from '@skribbl/shared';

import { normalizeWord, type WordDictionary } from './word-dictionary.js';

const shuffle = <T>(items: readonly T[]): T[] => [...items].sort(() => Math.random() - 0.5);

export const getWordOptions = (
  dictionary: WordDictionary,
  count: number,
  difficulty: keyof WordDictionary,
  excludedWords: readonly Word[] = [],
): Word[] => {
  const targetCount = Math.max(1, Math.floor(count));
  const words = dictionary[difficulty];
  if (excludedWords.length === 0) {
    return shuffle(words).slice(0, Math.min(targetCount, words.length));
  }

  const excludedWordSet = new Set(excludedWords.map((word) => normalizeWord(word)));
  const availableWords = words.filter((word) => !excludedWordSet.has(normalizeWord(word)));
  return shuffle(availableWords).slice(0, Math.min(targetCount, availableWords.length));
};
