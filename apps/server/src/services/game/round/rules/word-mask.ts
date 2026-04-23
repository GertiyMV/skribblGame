/**
 * Создаёт полностью скрытую маску для переданного слова.
 */
export const makeMask = (word: string): string =>
  Array.from(word)
    .map(() => '_')
    .join(' ');

/**
 * Открывает один случайный скрытый символ, сохраняя минимум один скрытый.
 */
export const revealHint = (word: string, mask: string): string => {
  const chars = mask.split(' ');
  const unrevealedIndices = chars.reduce<number[]>((acc, char, index) => {
    if (char === '_') {
      acc.push(index);
    }
    return acc;
  }, []);

  if (unrevealedIndices.length <= 1) {
    return mask;
  }

  const randomIndex = unrevealedIndices[Math.floor(Math.random() * unrevealedIndices.length)]!;
  const wordChars = Array.from(word);
  const updated = [...chars];
  updated[randomIndex] = wordChars[randomIndex]!;

  return updated.join(' ');
};
