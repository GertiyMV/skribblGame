/**
 * Creates a fully hidden mask for the provided word.
 */
export const makeMask = (word: string): string =>
  Array.from(word)
    .map(() => '_')
    .join(' ');

/**
 * Reveals one random unrevealed character while keeping at least one hidden.
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
