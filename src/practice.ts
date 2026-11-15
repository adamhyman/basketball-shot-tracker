import { type PracticeSession } from './model';
import { RIM_X } from './court/geometry';

type PracticeSpot = 'shortCorner' | 'corner' | 'elbow' | 'freeThrow' | 'topOfKey' | 'wing' | 'slot' | 'block';

// x, y in court feet like shots, for the right side. Spots off the middle are mirrored onto the left side.
// Labels sit toward half court from the spot, or toward the baseline if `below`; `edge` labels hug the sideline.
export const PRACTICE_SPOTS: { key: PracticeSpot; label: string; short: string; x: number; y: number; below?: boolean; edge?: boolean }[] = [
  { key: 'shortCorner', label: 'Short Corner', short: 'Short corner', x: 9, y: 3.5, below: true },
  { key: 'corner', label: 'Corner', short: 'Corner', x: 1.5, y: 4, edge: true },
  { key: 'elbow', label: 'Elbow (High Post)', short: 'Elbow', x: 17, y: 19 },
  { key: 'freeThrow', label: 'Free Throw', short: 'Free throw', x: 25, y: 19 },
  { key: 'topOfKey', label: 'Top of the Key', short: 'Top of key', x: 25, y: 30.5 },
  { key: 'wing', label: 'Wing', short: 'Wing', x: 7.5, y: 22 },
  { key: 'slot', label: 'Slot', short: 'Slot', x: 15.4, y: 28.3 },
  { key: 'block', label: 'Block (Low Post)', short: 'Block', x: 15, y: 7 },
];

type CourtSide = 'left' | 'right';

// Sides are as the shooter sees them facing the basket: left is the high-x side of the court.
export const sideAt = (x: number): CourtSide => (x > RIM_X ? 'left' : 'right');

// Spots off the middle are stored separately for each side, e.g. "corner-left".
export const practiceShotId = (spot: PracticeSpot, side: CourtSide | null) => (side ? `${spot}-${side}` : spot);

export const PRACTICE_SHOTS: { id: string; name: string }[] = PRACTICE_SPOTS.flatMap(({ key, label, x }) =>
  x === RIM_X
    ? [{ id: key, name: label }]
    : [
        { id: practiceShotId(key, 'left'), name: `Left ${label}` },
        { id: practiceShotId(key, 'right'), name: `Right ${label}` },
      ],
);

export const practiceLine = (list: PracticeSession[]) => {
  const made = list.reduce((sum, s) => sum + s.made, 0);
  const attempts = list.reduce((sum, s) => sum + s.attempts, 0);
  const pct = attempts ? ` (${Math.round((100 * made) / attempts)}%)` : '';
  return `${made}/${attempts}${pct}`;
};
