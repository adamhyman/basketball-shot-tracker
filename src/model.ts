

export type ShotResult = 'made' | 'madeFoul' | 'missed' | 'missedFoul';

export const RESULTS: { key: ShotResult; label: string }[] = [
  { key: 'made', label: 'Made' },
  { key: 'madeFoul', label: 'Made with foul' },
  { key: 'missed', label: 'Missed' },
  { key: 'missedFoul', label: 'Missed with foul' },
];

export const isMade = (r: ShotResult) => r === 'made' || r === 'madeFoul';

export const hasFoul = (r: ShotResult) => r === 'madeFoul' || r === 'missedFoul';

// A missed shot with a foul isn't charged as a field goal attempt.
export const isFieldGoalAttempt = (r: ShotResult) => r !== 'missedFoul';

export type Player = { id: string; name: string };

// x: 0..50 ft (left to right), y: 0..94 ft (near baseline up)
export type Shot = { id: string; playerId: string; x: number; y: number; result: ShotResult; date: number };

export type FreeThrow = { id: string; playerId: string; made: boolean; date: number };

export type ReboundKind = 'offensive' | 'defensive';

// Rebounds saved before the split have no kind.
export type Rebound = { id: string; playerId: string; kind?: ReboundKind; date: number };

export const REBOUND_KINDS: { key: ReboundKind; label: string }[] = [
  { key: 'defensive', label: 'Defensive Rebounds' },
  { key: 'offensive', label: 'Offensive Rebounds' },
];

export const shootingLine = (shots: Shot[]) => {
  const made = shots.filter((x) => isMade(x.result)).length;
  const attempts = shots.filter((x) => isFieldGoalAttempt(x.result)).length;
  const pct = attempts ? ` (${Math.round((100 * made) / attempts)}%)` : '';
  return `${made}/${attempts}${pct}`;
};

export type PracticeLocation = { id: string; name: string; customShots: { id: string; name: string }[] };

// shot is a PracticeShot id, or the id of one of the location's custom shots.
export type PracticeSession = { id: string; locationId: string; shot: string; made: number; attempts: number; date: number };
