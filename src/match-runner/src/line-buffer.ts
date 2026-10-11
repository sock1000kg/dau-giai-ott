/**
 * Pure byte-level NDJSON line buffer (P1-D05).
 *
 * Transport specification: Bot Protocol v1 section 2, section 3, section 7.
 * - Transport is UTF-8, exactly one JSON message per LF line (0x0A).
 * - Splits strictly on 0x0A (LF). Trailing CR is not stripped as protocol is LF.
 * - Operates directly on bytes, decoding UTF-8 only once an entire line is complete,
 *   guaranteeing multi-byte characters split across chunks decode without corruption.
 * - Bounded buffer: if pending line exceeds maxLineBytes, pending bytes are dropped
 *   immediately, entering a discarding state until LF, emitting exactly one 'oversize' event.
 */

export type LineEvent =
  | { readonly kind: 'line'; readonly text: string }
  | { readonly kind: 'oversize' };

export interface LineBufferOptions {
  readonly maxLineBytes: number;
}

export class LineBuffer {
  private readonly maxLineBytes: number;
  private readonly decoder = new TextDecoder('utf-8');
  private pendingChunks: Uint8Array[] = [];
  private currentPendingBytes = 0;
  private isDiscarding = false;

  constructor(options: LineBufferOptions) {
    if (options.maxLineBytes < 0) {
      throw new RangeError('maxLineBytes must be non-negative');
    }
    this.maxLineBytes = options.maxLineBytes;
  }

  /**
   * Number of bytes currently held in memory for the in-progress line.
   * In discarding state, drops to 0 immediately so memory never exceeds maxLineBytes.
   */
  get pendingBytes(): number {
    return this.currentPendingBytes;
  }

  /**
   * Push a chunk of raw bytes into the buffer and return any emitted LineEvent items.
   */
  push(chunk: Uint8Array): readonly LineEvent[] {
    if (chunk.byteLength === 0) {
      return [];
    }

    const events: LineEvent[] = [];
    let start = 0;

    for (let i = 0; i < chunk.byteLength; i++) {
      if (chunk[i] === 0x0a) {
        const slice = chunk.subarray(start, i);
        start = i + 1;

        if (this.isDiscarding) {
          this.isDiscarding = false;
          events.push({ kind: 'oversize' });
        } else {
          if (this.currentPendingBytes + slice.byteLength > this.maxLineBytes) {
            this.pendingChunks = [];
            this.currentPendingBytes = 0;
            events.push({ kind: 'oversize' });
          } else {
            const lineBytes = this.assembleLine(slice);
            const text = this.decoder.decode(lineBytes);
            events.push({ kind: 'line', text });
          }
        }
      } else if (!this.isDiscarding) {
        if (this.currentPendingBytes + (i - start + 1) > this.maxLineBytes) {
          this.pendingChunks = [];
          this.currentPendingBytes = 0;
          this.isDiscarding = true;
        }
      }
    }

    if (start < chunk.byteLength && !this.isDiscarding) {
      const slice = chunk.subarray(start);
      if (this.currentPendingBytes + slice.byteLength > this.maxLineBytes) {
        this.pendingChunks = [];
        this.currentPendingBytes = 0;
        this.isDiscarding = true;
      } else {
        this.pendingChunks.push(slice.slice());
        this.currentPendingBytes += slice.byteLength;
      }
    }

    return events;
  }

  private assembleLine(finalSlice: Uint8Array): Uint8Array {
    if (this.pendingChunks.length === 0) {
      this.currentPendingBytes = 0;
      return finalSlice;
    }
    this.pendingChunks.push(finalSlice);
    const totalLength = this.currentPendingBytes + finalSlice.byteLength;
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const piece of this.pendingChunks) {
      result.set(piece, offset);
      offset += piece.byteLength;
    }
    this.pendingChunks = [];
    this.currentPendingBytes = 0;
    return result;
  }

  /**
   * Drops any incomplete trailing partial line upon stream end.
   * Trailing partial lines without LF are not emitted as messages.
   */
  flushOnEnd(): { readonly droppedBytes: number } {
    const droppedBytes = this.currentPendingBytes;
    this.pendingChunks = [];
    this.currentPendingBytes = 0;
    this.isDiscarding = false;
    return { droppedBytes };
  }

  /**
   * Resets buffer state completely.
   */
  clear(): void {
    this.pendingChunks = [];
    this.currentPendingBytes = 0;
    this.isDiscarding = false;
  }
}

export function createLineBuffer(options: LineBufferOptions): LineBuffer {
  return new LineBuffer(options);
}
