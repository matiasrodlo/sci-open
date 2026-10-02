/**
 * Runs at most `concurrency` of the given tasks at once, in the order given.
 * The npm `p-limit` is ESM-only; this is the whole of what is needed.
 */
export default function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        // Through a resolved promise, so a task that throws synchronously
        // rejects its own promise instead of stalling the queue.
        Promise.resolve().then(task).then(resolve, reject).finally(next);
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
}
