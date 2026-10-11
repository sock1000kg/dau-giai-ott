import { describe, expect, it } from 'vitest';

import { createLineBuffer, LineBuffer } from '../src/line-buffer.ts';

describe('LineBuffer (P1-D05 pure NDJSON framing)', () => {
  it('1. One chunk with several lines → events in order; empty lines kept', () => {
    const buffer = createLineBuffer({ maxLineBytes: 100 });
    const chunk = Buffer.from('line1\nline2\n\nline3\n');
    const events = buffer.push(chunk);

    expect(events).toEqual([
      { kind: 'line', text: 'line1' },
      { kind: 'line', text: 'line2' },
      { kind: 'line', text: '' },
      { kind: 'line', text: 'line3' },
    ]);
    expect(buffer.pendingBytes).toBe(0);
  });

  it('2. A line split across many chunks (including byte-by-byte) → one event', () => {
    const buffer = new LineBuffer({ maxLineBytes: 100 });
    const fullText = 'the quick brown fox jumps over the lazy dog\n';
    const bytes = Buffer.from(fullText);

    const allEvents = [];
    for (let i = 0; i < bytes.length; i++) {
      const singleByteChunk = bytes.subarray(i, i + 1);
      const events = buffer.push(singleByteChunk);
      if (events.length > 0) {
        allEvents.push(...events);
      }
    }

    expect(allEvents).toEqual([
      { kind: 'line', text: 'the quick brown fox jumps over the lazy dog' },
    ]);
    expect(buffer.pendingBytes).toBe(0);
  });

  it('3. Multi-byte UTF-8 (e.g. "đ", an emoji) split across chunk boundaries decodes correctly', () => {
    const buffer = createLineBuffer({ maxLineBytes: 100 });
    // "đ" in UTF-8 is 0xC4 0x91. Emoji "🎮" in UTF-8 is 0xF0 0x9F 0x8E 0xAE (4 bytes).
    const text = 'tiếng Việt đ và emoji 🎮\n';
    const fullBytes = Buffer.from(text, 'utf-8');

    // Split right in the middle of "đ" and "🎮"
    const part1 = fullBytes.subarray(0, 14); // contains 0xC4 (first byte of đ)
    const part2 = fullBytes.subarray(14, 25); // contains 0x91 and first bytes of emoji
    const part3 = fullBytes.subarray(25); // rest of emoji + \n

    const events1 = buffer.push(part1);
    expect(events1).toEqual([]);
    expect(buffer.pendingBytes).toBe(14);

    const events2 = buffer.push(part2);
    expect(events2).toEqual([]);
    expect(buffer.pendingBytes).toBe(25);

    const events3 = buffer.push(part3);
    expect(events3).toEqual([
      { kind: 'line', text: 'tiếng Việt đ và emoji 🎮' },
    ]);
    expect(buffer.pendingBytes).toBe(0);
  });

  it('4. Exactly maxLineBytes bytes → line; maxLineBytes + 1 → one oversize, buffer memory never above the limit, and the next line after it parses normally', () => {
    const maxLineBytes = 10;
    const buffer = createLineBuffer({ maxLineBytes });

    // Case 4a: Exactly maxLineBytes bytes (excluding LF)
    const exact10 = '1234567890\n';
    expect(Buffer.byteLength('1234567890')).toBe(maxLineBytes);
    const eventsExact = buffer.push(Buffer.from(exact10));
    expect(eventsExact).toEqual([{ kind: 'line', text: '1234567890' }]);
    expect(buffer.pendingBytes).toBe(0);

    // Case 4b: maxLineBytes + 1 bytes delivered in chunks to verify pendingBytes cap
    // Push exactly 10 bytes without LF
    buffer.push(Buffer.from('1234567890'));
    expect(buffer.pendingBytes).toBe(10);

    // Push the 11th byte (exceeds limit)
    const overflowEvents = buffer.push(Buffer.from('X'));
    expect(overflowEvents).toEqual([]);
    // Memory limit enforced: pendingBytes drops to 0 immediately upon exceeding maxLineBytes
    expect(buffer.pendingBytes).toBe(0);

    // Push more bytes into the discarded line; pendingBytes remains 0
    buffer.push(Buffer.from('lots of garbage bytes that must not be held in memory'));
    expect(buffer.pendingBytes).toBe(0);

    // Complete the oversized line with LF → exactly one oversize event
    const endOversizeEvents = buffer.push(Buffer.from('\n'));
    expect(endOversizeEvents).toEqual([{ kind: 'oversize' }]);
    expect(buffer.pendingBytes).toBe(0);

    // Case 4c: The next line parses normally
    const nextLineEvents = buffer.push(Buffer.from('ok line\n'));
    expect(nextLineEvents).toEqual([{ kind: 'line', text: 'ok line' }]);
    expect(buffer.pendingBytes).toBe(0);

    // Case 4d: Oversize line delivered in a single chunk with following normal line
    const combinedChunk = Buffer.from('12345678901234567890\nrecovered\n');
    const combinedEvents = buffer.push(combinedChunk);
    expect(combinedEvents).toEqual([
      { kind: 'oversize' },
      { kind: 'line', text: 'recovered' },
    ]);
    expect(buffer.pendingBytes).toBe(0);
  });

  it('5. Trailing partial line without LF at end → not emitted as a line', () => {
    const buffer = createLineBuffer({ maxLineBytes: 100 });
    const events = buffer.push(Buffer.from('complete\npartial line'));

    expect(events).toEqual([{ kind: 'line', text: 'complete' }]);
    expect(buffer.pendingBytes).toBe(Buffer.byteLength('partial line'));

    // flushOnEnd drops the partial line, returning dropped byte count
    const endResult = buffer.flushOnEnd();
    expect(endResult.droppedBytes).toBe(Buffer.byteLength('partial line'));
    expect(buffer.pendingBytes).toBe(0);

    // Clean buffer state after flushOnEnd
    const nextEvents = buffer.push(Buffer.from('next\n'));
    expect(nextEvents).toEqual([{ kind: 'line', text: 'next' }]);
  });
});
