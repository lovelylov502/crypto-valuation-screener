/** A CLI must stay alive until its async work settles. AbortSignal.timeout alone
 * uses an unreferenced timer and cannot guarantee that process lifetime. */
export async function withDeadline<T>(work: () => Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("collector_deadline_exceeded")), milliseconds);
  });
  try { return await Promise.race([work(), deadline]); }
  finally { clearTimeout(timer!); }
}
