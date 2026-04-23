import { readFileSync } from 'node:fs';
import path from 'node:path';

import { type Word, type WordDifficulty, wordSchema } from '@skribbl/shared';
import { z } from 'zod';

export type WordDictionary = Record<WordDifficulty, Word[]>;

export type WordServiceOptions = {
  dictionaryPath?: string;
  dictionaryData?: unknown;
};

const DIFFICULTIES: WordDifficulty[] = ['medium', 'hard'];
const MIN_WORDS_PER_DIFFICULTY = 250;
export const DEFAULT_FALLBACK_WORD: Word = 'кот';

const dictionarySchema = z.object({
  medium: z.array(wordSchema).min(1),
  hard: z.array(wordSchema).min(1),
});

export const normalizeWord = (value: string): string =>
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

const readDictionaryPayload = (dictionaryPath: string): unknown => {
  const rawJson = readFileSync(dictionaryPath, 'utf8');
  return JSON.parse(rawJson) as unknown;
};

const validateDictionaryQuality = (dictionary: WordDictionary): WordDictionary => {
  const normalizedWords = new Map<string, { difficulty: WordDifficulty; original: Word }>();
  const allNormalizedWords: string[] = [];

  for (const difficulty of DIFFICULTIES) {
    if (dictionary[difficulty].length < MIN_WORDS_PER_DIFFICULTY) {
      throw new Error(
        `Dictionary difficulty "${difficulty}" must contain at least ${MIN_WORDS_PER_DIFFICULTY} words, received ${dictionary[difficulty].length}.`,
      );
    }

    for (const originalWord of dictionary[difficulty]) {
      const normalizedWord = normalizeWord(originalWord);

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

  return dictionary;
};

const parseDictionary = (payload: unknown): WordDictionary =>
  validateDictionaryQuality(dictionarySchema.parse(payload));

export const loadDictionary = (options: WordServiceOptions = {}): WordDictionary => {
  const dictionaryPath =
    options.dictionaryPath ?? path.join(import.meta.dirname, 'dictionaries', 'ru.json');
  const payload = options.dictionaryData ?? readDictionaryPayload(dictionaryPath);
  return parseDictionary(payload);
};

export const getFallbackWords = (dictionary: WordDictionary): Record<WordDifficulty, Word> => ({
  medium: dictionary.medium[0] ?? DEFAULT_FALLBACK_WORD,
  hard: dictionary.hard[0] ?? dictionary.medium[0] ?? DEFAULT_FALLBACK_WORD,
});
