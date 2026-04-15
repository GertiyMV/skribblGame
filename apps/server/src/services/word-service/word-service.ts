import { readFileSync } from 'node:fs';
import path from 'node:path';

import { type Word, wordSchema } from '@skribbl/shared';
import { z } from 'zod';

type WordDifficulty = 'easy' | 'medium' | 'hard';

type WordDictionary = Record<WordDifficulty, Word[]>;

type WordServiceOptions = {
  dictionaryPath?: string;
  dictionaryData?: unknown;
};

const DIFFICULTIES: WordDifficulty[] = ['easy', 'medium', 'hard'];
const MIN_TOTAL_WORDS = 200;
const DEFAULT_FALLBACK_WORD: Word = 'кот';

const dictionarySchema = z.object({
  easy: z.array(wordSchema).min(1),
  medium: z.array(wordSchema).min(1),
  hard: z.array(wordSchema).min(1),
});

const normalizeWord = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLowerCase().replaceAll('ё', 'е');

const areNearWordForms = (leftWord: string, rightWord: string): boolean => {
  if (leftWord === rightWord) {
    return true;
  }

  if (leftWord.length < 6 || rightWord.length < 6) {
    return false;
  }

  if (leftWord.slice(0, 3) !== rightWord.slice(0, 3)) {
    return false;
  }

  if (Math.abs(leftWord.length - rightWord.length) > 1) {
    return false;
  }

  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;

  while (leftIndex < leftWord.length && rightIndex < rightWord.length) {
    if (leftWord[leftIndex] === rightWord[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    edits += 1;
    if (edits > 1) {
      return false;
    }

    if (leftWord.length > rightWord.length) {
      leftIndex += 1;
      continue;
    }

    if (leftWord.length < rightWord.length) {
      rightIndex += 1;
      continue;
    }

    leftIndex += 1;
    rightIndex += 1;
  }

  if (leftIndex < leftWord.length || rightIndex < rightWord.length) {
    edits += 1;
  }

  return edits <= 1;
};

const shuffle = <T>(items: readonly T[]): T[] => [...items].sort(() => Math.random() - 0.5);

const readDictionaryPayload = (dictionaryPath: string): unknown => {
  const rawJson = readFileSync(dictionaryPath, 'utf8');
  return JSON.parse(rawJson) as unknown;
};

const validateDictionaryQuality = (dictionary: WordDictionary): WordDictionary => {
  const normalizedWords = new Map<string, { difficulty: WordDifficulty; original: Word }>();
  const allNormalizedWords: string[] = [];
  let totalWordCount = 0;

  for (const difficulty of DIFFICULTIES) {
    for (const originalWord of dictionary[difficulty]) {
      const normalizedWord = normalizeWord(originalWord);
      totalWordCount += 1;

      const duplicatedWord = normalizedWords.get(normalizedWord);
      if (duplicatedWord) {
        throw new Error(
          [
            `Duplicate word detected: "${originalWord}" (${difficulty})`,
            `already exists as "${duplicatedWord.original}" (${duplicatedWord.difficulty}).`,
          ].join(' '),
        );
      }

      normalizedWords.set(normalizedWord, { difficulty, original: originalWord });
      allNormalizedWords.push(normalizedWord);
    }
  }

  for (let leftIndex = 0; leftIndex < allNormalizedWords.length; leftIndex += 1) {
    const leftWord = allNormalizedWords[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < allNormalizedWords.length; rightIndex += 1) {
      const rightWord = allNormalizedWords[rightIndex]!;
      if (!areNearWordForms(leftWord, rightWord)) {
        continue;
      }

      throw new Error(`Near-duplicate word forms detected: "${leftWord}" and "${rightWord}".`);
    }
  }

  if (totalWordCount < MIN_TOTAL_WORDS) {
    throw new Error(
      `Dictionary must contain at least ${MIN_TOTAL_WORDS} words, received ${totalWordCount}.`,
    );
  }

  return dictionary;
};

const parseDictionary = (payload: unknown): WordDictionary =>
  validateDictionaryQuality(dictionarySchema.parse(payload));

export class WordService {
  private readonly dictionary: WordDictionary;
  private readonly allWords: Word[];
  private readonly fallbackWord: Word;

  constructor(options: WordServiceOptions = {}) {
    const dictionaryPath =
      options.dictionaryPath ?? path.join(import.meta.dirname, 'dictionaries', 'ru.json');
    const payload = options.dictionaryData ?? readDictionaryPayload(dictionaryPath);
    this.dictionary = parseDictionary(payload);
    this.allWords = DIFFICULTIES.flatMap((difficulty) => this.dictionary[difficulty]);
    this.fallbackWord = this.dictionary.easy[0] ?? DEFAULT_FALLBACK_WORD;
  }

  getWordOptions(count: number): Word[] {
    const targetCount = Math.max(1, Math.floor(count));
    return shuffle(this.allWords).slice(0, Math.min(targetCount, this.allWords.length));
  }

  pickFallbackWord(): Word {
    return this.fallbackWord;
  }

  getWordCount(): number {
    return this.allWords.length;
  }
}
