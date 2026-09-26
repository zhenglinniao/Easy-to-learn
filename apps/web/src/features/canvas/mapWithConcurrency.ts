export const mapWithConcurrency = async <Input, Output>(
  items: readonly Input[],
  concurrency: number,
  worker: (item: Input, index: number) => Promise<Output>,
): Promise<Output[]> => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency must be a positive integer');
  }
  if (items.length === 0) return [];

  const results = new Array<Output>(items.length);
  let nextIndex = 0;
  let stopped = false;
  const run = async () => {
    while (!stopped) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index]!, index);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
};
