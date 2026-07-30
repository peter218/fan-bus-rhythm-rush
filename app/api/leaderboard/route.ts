import { desc, eq } from "drizzle-orm";
import { ensureDbSchema, getDb } from "../../../db";
import { leaderboardScores } from "../../../db/schema";

const TOP_LIMIT = 5;

function concertForScore(score: number) {
  if (score >= 6_500) return "星河体育场";
  if (score >= 4_500) return "霓虹体育馆";
  if (score >= 2_800) return "城市剧场";
  if (score >= 1_400) return "星光 Livehouse";
  return "街角快闪";
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

// Returned when there is no D1 binding. A 200 with an empty board keeps the game
// playable and quiet, rather than making the client show a sync error after
// every single run on a platform that simply has no leaderboard storage.
const DISABLED = { leaderboard: [], disabled: true };

async function getLeaderboard(db: Db) {
  const rows = await db
    .select()
    .from(leaderboardScores)
    .orderBy(
      desc(leaderboardScores.score),
      desc(leaderboardScores.fans),
      desc(leaderboardScores.maxCombo),
      desc(leaderboardScores.updatedAt),
    )
    .limit(TOP_LIMIT);

  return rows.map((row) => ({
    id: row.id,
    playerId: row.playerId,
    name: row.playerName,
    fans: row.fans,
    maxCombo: row.maxCombo,
    score: row.score,
    concert: row.concert,
    song: row.song,
    createdAt: row.updatedAt,
  }));
}

export async function GET() {
  try {
    if (!(await ensureDbSchema())) return Response.json(DISABLED);
    const db = await getDb();
    if (!db) return Response.json(DISABLED);
    return Response.json({ leaderboard: await getLeaderboard(db) });
  } catch {
    return Response.json(
      { error: "全局排行榜暂时不可用" },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      playerId?: string;
      name?: string;
      fans?: number;
      maxCombo?: number;
      song?: string;
    };
    const playerId = payload.playerId?.trim() ?? "";
    const name = (payload.name?.trim() || "巡演玩家").slice(0, 10);
    const fans = Math.round(Number(payload.fans));
    const maxCombo = Math.round(Number(payload.maxCombo));
    const song = (payload.song?.trim() || "未知歌曲").slice(0, 80);

    if (
      playerId.length < 8 ||
      playerId.length > 80 ||
      !Number.isInteger(fans) ||
      fans < 0 ||
      fans > 120 ||
      !Number.isInteger(maxCombo) ||
      maxCombo < 0 ||
      maxCombo > 10_000
    ) {
      return Response.json({ error: "排行榜成绩无效" }, { status: 400 });
    }

    if (!(await ensureDbSchema())) return Response.json(DISABLED);
    const db = await getDb();
    if (!db) return Response.json(DISABLED);
    const score = fans * maxCombo;
    const concert = concertForScore(score);
    const [existing] = await db
      .select()
      .from(leaderboardScores)
      .where(eq(leaderboardScores.playerId, playerId))
      .limit(1);

    if (!existing) {
      await db.insert(leaderboardScores).values({
        playerId,
        playerName: name,
        fans,
        maxCombo,
        score,
        concert,
        song,
        updatedAt: Date.now(),
      });
    } else if (
      score > existing.score ||
      (score === existing.score && fans > existing.fans) ||
      (score === existing.score &&
        fans === existing.fans &&
        maxCombo > existing.maxCombo)
    ) {
      await db
        .update(leaderboardScores)
        .set({
          playerName: name,
          fans,
          maxCombo,
          score,
          concert,
          song,
          updatedAt: Date.now(),
        })
        .where(eq(leaderboardScores.playerId, playerId));
    } else if (name !== existing.playerName) {
      await db
        .update(leaderboardScores)
        .set({ playerName: name, updatedAt: Date.now() })
        .where(eq(leaderboardScores.playerId, playerId));
    }

    return Response.json(
      { leaderboard: await getLeaderboard(db) },
      { status: 201 },
    );
  } catch {
    return Response.json(
      { error: "全局排行榜成绩提交失败" },
      { status: 500 },
    );
  }
}
