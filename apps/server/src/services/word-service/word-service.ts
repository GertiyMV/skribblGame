import type { Word, WordDifficulty } from '@skribbl/shared';

import {
  getFallbackWords,
  loadDictionary,
  type WordDictionary,
  type WordServiceOptions,
} from './word-dictionary.js';
import { getWordOptions as selectWordOptions } from './word-selection.js';

export class WordService {
  private readonly dictionary: WordDictionary;
  private readonly fallbackWords: Record<WordDifficulty, Word>;

  constructor(options: WordServiceOptions = {}) {
    this.dictionary = loadDictionary(options);
    this.fallbackWords = getFallbackWords(this.dictionary);
  }

  getWordOptions(
    count: number,
    difficulty: WordDifficulty,
    excludedWords: readonly Word[] = [],
  ): Word[] {
    return selectWordOptions(this.dictionary, count, difficulty, excludedWords);
  }

  pickFallbackWord(difficulty: WordDifficulty): Word {
    return this.fallbackWords[difficulty];
  }

  getWordCount(difficulty?: WordDifficulty): number {
    if (difficulty) {
      return this.dictionary[difficulty].length;
    }
    return Object.values(this.dictionary).reduce((sum, words) => sum + words.length, 0);
  }
}
