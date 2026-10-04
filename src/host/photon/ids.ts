/**
 * Four-digit player IDs the host assigns: one per browser, keyed by the original install ID
 * (FirebaseManager.GetGuestUID), kept in `file` when given so a friend keeps the same ID across sessions.
 */
export async function playerIds(file?: string) {
  const saved = file && await Bun.file(file).exists() ? await Bun.file(file).json() as Record<string, string> : {};
  const byDevice = new Map(Object.entries(saved));
  let saving = Promise.resolve();
  return {
    /** The device's ID, assigning the lowest free one on first sight. */
    assign(device: string) {
      const known = byDevice.get(device);
      if (known) return known;
      const taken = new Set(byDevice.values());
      let number = 1;
      while (taken.has(String(number).padStart(4, '0'))) number++;
      if (number > 9999) throw new Error('No free player ID.');
      const id = String(number).padStart(4, '0');
      byDevice.set(device, id);
      if (file) {
        const text = JSON.stringify(Object.fromEntries(byDevice), null, 2) + '\n';
        saving = saving.then(async () => { await Bun.write(file, text); });
      }
      return id;
    },
  };
}

export type PlayerIds = Awaited<ReturnType<typeof playerIds>>;
