'use client';

/**
 * Skeleton.tsx — what the words look like while they are being rewritten. (round 6, P11)
 *
 * Shape fires and returns a job id; the caption keeps showing the OLD text until a poll lands the
 * new one, which on the device reads as nothing having happened — the client taps Shape, reads the
 * same sentence, and taps it again. The `flash()` line that said so scrolled past in three seconds
 * and, until this session, appeared at the other end of the screen.
 *
 * So the region being rewritten says so, in place, for as long as it takes. Lines rather than a
 * spinner: a spinner says *the app is busy*, and lines the width of the paragraph they replace say
 * *these words are being written*, which is the true and more specific claim.
 *
 * REDUCED MOTION HOLDS THEM STILL. The animation is the secondary channel; the fact that the words
 * are gone and grey bars are in their place is the primary one, and it survives without motion.
 */
import React from 'react';

/** Bar widths, as a fraction of the line. Uneven on purpose — a stack of equal bars reads as a
 *  loading graphic, and an uneven one reads as prose. */
const LINES = ['100%', '96%', '88%', '64%'];

export function Skeleton({ lines = LINES.length, testid = 'skeleton' }: { lines?: number; testid?: string }) {
  return (
    <div data-testid={testid} role="status" aria-label="Writing this now" className="flex flex-col gap-2.5 pt-1">
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i} aria-hidden="true"
          style={{ width: LINES[i % LINES.length], animationDelay: `${i * 120}ms` }}
          className="block h-[13px] rounded-full bg-line/25 motion-safe:animate-pulse"
        />
      ))}
    </div>
  );
}
