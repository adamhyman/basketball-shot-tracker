const API_URL = 'https://basketball.highlightly.net/matches';

// Set in .env.local, which is kept out of git.
const API_KEY = process.env.EXPO_PUBLIC_HIGHLIGHTLY_API_KEY;

export type GameStatus = 'live' | 'upcoming' | 'final' | 'other';

export type NbaTeam = { name: string; logo: string; score: number | null };

export type NbaGame = {
  id: number;
  start: number;
  status: GameStatus;
  description: string;
  away: NbaTeam;
  home: NbaTeam;
};

type ApiTeam = { name: string; logo: string };

type ApiMatch = {
  id: number;
  date: string;
  state: { description: string; score: { current: string | null } };
  awayTeam: ApiTeam;
  homeTeam: ApiTeam;
};

const statusOf = (description: string): GameStatus => {
  if (description === 'Not started') return 'upcoming';
  if (description.startsWith('Finished')) return 'final';
  if (/quarter|half|overtime|break/i.test(description)) return 'live';
  return 'other';
};

const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const STATUS_ORDER: GameStatus[] = ['live', 'upcoming', 'other', 'final'];

// Today's games: live first, then upcoming, then finished.
export async function fetchTodaysGames(): Promise<{ games: NbaGame[]; requestsLeft: number | null }> {
  if (!API_KEY) throw new Error('Missing Highlightly API key.');
  const today = localDateKey(new Date());
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const res = await fetch(`${API_URL}?leagueName=NBA&date=${today}&timezone=${encodeURIComponent(timezone)}`, {
    headers: { 'x-rapidapi-key': API_KEY },
  });
  if (res.status === 429) throw new Error('Daily request limit reached. Try again later.');
  if (!res.ok) throw new Error(`Couldn't load games (error ${res.status}).`);
  const body: { data: ApiMatch[] } = await res.json();
  const left = res.headers.get('x-ratelimit-requests-remaining');

  const games = body.data
    .map((m): NbaGame => {
      // The API lists the home score first.
      const [home, away] = (m.state.score.current ?? '').split(' - ').map((s) => (s === '' ? null : Number(s)));
      return {
        id: m.id,
        start: Date.parse(m.date),
        status: statusOf(m.state.description),
        description: m.state.description,
        away: { name: m.awayTeam.name, logo: m.awayTeam.logo, score: away ?? null },
        home: { name: m.homeTeam.name, logo: m.homeTeam.logo, score: home ?? null },
      };
    })
    // The API sometimes includes games from other days.
    .filter((g) => g.status === 'live' || localDateKey(new Date(g.start)) === today)
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.start - b.start);

  return { games, requestsLeft: left === null ? null : Number(left) };
}
