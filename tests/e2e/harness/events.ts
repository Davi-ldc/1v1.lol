import { sha256 } from '../../../src/host/build/inputs';

export type RecordEvent = (kind: string, data: unknown) => void;

interface Entry { kind: string; data: unknown; count: number; firstAt: number; lastAt: number }
const LIMITS = { entries: 256, messageBytes: 8192, bytes: 2_000_000 };

/** Bounded event log; identical events are counted once. */
export class EventLog {
  private readonly entries = new Map<string, Entry>();
  private readonly started = performance.now();
  private bytes = 0;
  private omitted = 0;

  record = (kind: string, data: unknown): void => {
    let text: string;
    try { text = JSON.stringify(data, (_, value) => typeof value === 'bigint' ? String(value) : value) ?? 'null'; }
    catch { text = JSON.stringify({ unserializable: true, type: typeof data }); }
    const key = sha256(`${kind}\0${text}`);
    const time = Math.round(performance.now() - this.started);
    const existing = this.entries.get(key);
    if (existing) { existing.count++; existing.lastAt = time; return; }
    const payload = Buffer.byteLength(text) > LIMITS.messageBytes
      ? { truncated: true, excerpt: Buffer.from(text).subarray(0, LIMITS.messageBytes).toString('utf8') }
      : JSON.parse(text);
    const entry = { kind, data: payload, count: 1, firstAt: time, lastAt: time };
    const size = Buffer.byteLength(JSON.stringify(entry));
    if (this.entries.size >= LIMITS.entries || this.bytes + size > LIMITS.bytes) { this.omitted++; return; }
    this.bytes += size;
    this.entries.set(key, entry);
  };

  snapshot() {
    return { omittedEvents: this.omitted, events: [...this.entries.values()] };
  }

  /** Managed exceptions printed to the console and resources the host did not supply. */
  summary() {
    const events = [...this.entries.values()];
    const exceptions = events.flatMap(event => {
      const text = (event.data as { text?: unknown } | null)?.text;
      return event.kind.startsWith('console-') && typeof text === 'string' && /\b[\w.]*Exception\b/.test(text)
        ? [{ text: text.slice(0, 2000), count: event.count }] : [];
    });
    return { managedExceptions: exceptions.slice(0, 20), otherManagedExceptions: Math.max(0, exceptions.length - 20),
      missingResources: events.filter(event => event.kind === 'missing-resource').map(event => event.data) };
  }
}
