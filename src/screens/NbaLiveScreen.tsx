import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Image, RefreshControl } from 'react-native';

import { type NbaGame, type NbaTeam, fetchTodaysGames } from '../nba';
import { useTheme } from '../theme';

// The free API plan allows about 100 requests a day, so refresh slowly and stop when running low.
const REFRESH_MS = 2 * 60 * 1000;
const MIN_REQUESTS_FOR_AUTO_REFRESH = 10;

const formatTime = (date: number) => new Date(date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function TeamRow({ team, other, showScore }: { team: NbaTeam; other: NbaTeam; showScore: boolean }) {
  const { styles } = useTheme();
  const leading = team.score !== null && other.score !== null && team.score > other.score;
  return (
    <View style={styles.gameTeam}>
      <Image source={{ uri: team.logo }} style={styles.gameLogo} />
      <Text style={[styles.gameTeamName, leading && styles.gameLeading]} numberOfLines={1}>
        {team.name}
      </Text>
      {showScore && <Text style={[styles.gameScore, leading && styles.gameLeading]}>{team.score ?? '-'}</Text>}
    </View>
  );
}

function GameCard({ game }: { game: NbaGame }) {
  const { styles } = useTheme();
  const status =
    game.status === 'upcoming' ? formatTime(game.start) : game.status === 'final' ? 'Final' : game.description;
  return (
    <View style={styles.statCard}>
      <View style={styles.gameStatusRow}>
        {game.status === 'live' && (
          <View style={styles.liveBadge}>
            <Text style={styles.liveBadgeText}>LIVE</Text>
          </View>
        )}
        <Text style={styles.gameStatus}>{status}</Text>
      </View>
      <TeamRow team={game.away} other={game.home} showScore={game.status !== 'upcoming'} />
      <TeamRow team={game.home} other={game.away} showScore={game.status !== 'upcoming'} />
    </View>
  );
}

export function NbaLiveScreen() {
  const { t, styles } = useTheme();
  const [games, setGames] = useState<NbaGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const [requestsLeft, setRequestsLeft] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchTodaysGames();
      setGames(res.games);
      setRequestsLeft(res.requestsLeft);
      setUpdated(Date.now());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load games.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const anyLive = games?.some((g) => g.status === 'live') ?? false;
  const autoRefresh = anyLive && (requestsLeft === null || requestsLeft > MIN_REQUESTS_FOR_AUTO_REFRESH);
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: 12, gap: 10 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.muted} />}
    >
      {error && <Text style={styles.warning}>{error}</Text>}
      {games === null && !error && <Text style={styles.hint}>Loading games…</Text>}
      {games?.length === 0 && <Text style={styles.hint}>No NBA games today.</Text>}
      {games?.map((g) => <GameCard key={g.id} game={g} />)}
      {updated !== null && (
        <Text style={styles.statSmall}>
          Updated {formatTime(updated)}
          {autoRefresh ? ' · refreshes every 2 min' : ''} · pull down to refresh
          {requestsLeft !== null ? ` · ${requestsLeft} requests left today` : ''}
        </Text>
      )}
    </ScrollView>
  );
}
