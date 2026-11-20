// The token radar's model (radar-2): one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// EVERY rankable pre-token protocol below the watchlist floor: the early rows the radar exists to
// find. A protocol is pre-token when its record carries no token (no market cap, no CoinGecko id, no
// symbol); live-token protocols are kept apart in their own view with the market's own values, never
// mixed into the ranked board. Rankable excludes exchanges (CEX) and versioned pools (a name ending
// in V2, v2, 2.0 and the like), which are a pool of another protocol, not a protocol of their own.
//
// Implied value follows only from the snapshot's own figures. The model is four factors, all of them
// plain arithmetic (no transcendentals, so the same bytes come out of any Node build):
//
//   multiple   = the category's price per dollar of TVL (0.15..0.35, see CATEGORY_MULTIPLES)
//   base       = tvl_usd x multiple
//   growthMult = 1 + 0.6 x change_7d / (50 + |change_7d|)      -- saturating: a week of +4,000%
//                growth is not eighty times a week of +50%; the snapshot's biggest weekly move is
//                +4,448%, and a linear response would let one outlier own the board. The factor
//                stays inside (0.4, 1.6); an unreported change counts as 0.
//   ageMult    = 0.70 + 0.30 x age_days / (age_days + 365)     -- saturating: each year a protocol
//                runs with no token proves a little more, and a five-year record is not five times
//                a one-year record. An unlisted age counts as 365 days.
//   chainMult  = 1 + 0.02 x min(chains - 1, 10)               -- a protocol live on several chains
//                has more surface to monetise; capped, so a 176-chain listing cannot dominate.
//   implied    = max(1, round(base x growthMult x ageMult x chainMult))
//
// The category multiple is the model's one judgement call: different protocol types monetise a
// dollar of TVL differently. Lending and derivatives earn fees on every dollar lent or traded, so
// they price higher; bridges move value thinly and price lower. The table is stated in full in the
// dashboard and the README, and no protocol name is ever special-cased: the same function scores
// every row, and the category comes from the snapshot itself.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_saturation_pct: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_scale_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
  default_multiple: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_saturation_pct: 50,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_scale_days: 365,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_cap: 10,
  default_multiple: 0.25,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/**
 * The category multiple table: a category's price per dollar of TVL. Matched in order, first match
 * wins; a category that matches nothing takes the default. The `why` is what the dashboard shows.
 */
export const CATEGORY_MULTIPLES: Array<{ match: RegExp; multiple: number; why: string }> = [
  { match: /lending|cdp|collateral/i, multiple: 0.35, why: 'lending and credit earn on every dollar lent' },
  { match: /derivative|perpetual|interest rate/i, multiple: 0.35, why: 'derivatives earn trading and funding fees' },
  { match: /index/i, multiple: 0.25, why: 'indexes earn a management fee' },
  { match: /dex/i, multiple: 0.3, why: 'exchanges earn swap fees on volume' },
  { match: /rwa/i, multiple: 0.3, why: 'real-world assets earn off-chain yield' },
  { match: /prediction/i, multiple: 0.3, why: 'prediction markets earn on resolved volume' },
  { match: /^chain$/i, multiple: 0.3, why: 'a chain taxes everything built on it' },
  { match: /curator|allocator/i, multiple: 0.25, why: 'curators earn a share of the yield they route' },
  { match: /insurance/i, multiple: 0.25, why: 'insurance earns premiums on cover sold' },
  { match: /yield|aggregator|farm/i, multiple: 0.2, why: 'yield products pass most of the yield through' },
  { match: /stable/i, multiple: 0.2, why: 'stable assets earn thin reserve yield' },
  { match: /payment|card|otc|governance/i, multiple: 0.2, why: 'services earn per transaction' },
  { match: /staking|restak|anchor btc|decentralized btc/i, multiple: 0.18, why: 'staking earns a small cut of rewards' },
  { match: /bridge/i, multiple: 0.15, why: 'bridges move value thinly' },
];

/** A category's price per dollar of TVL: the first table row that matches, else the default. */
export function categoryMultiple(category: string | null, model: ModelConstants = MODEL): number {
  if (category === null) return model.default_multiple;
  for (const row of CATEGORY_MULTIPLES) {
    if (row.match.test(category)) return row.multiple;
  }
  return model.default_multiple;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row, with its farm plan and model breakdown. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  category_multiples: Array<{ pattern: string; multiple: number; why: string }>;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The four factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = finite(protocol.change_7d, 0);
  const growthMult = 1 + model.growth_weight * (growthPct / (model.growth_saturation_pct + Math.abs(growthPct)));
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + model.maturity_range * (Math.max(ageForModel, 0) / (Math.max(ageForModel, 0) + model.maturity_scale_days));
  const chainMult = 1 + model.chain_step * Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_cap);
  const multiple = categoryMultiple(protocol.category, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * chainMult));
  return { implied, multiple, growthPct, growthMult, maturityMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: EVERY rankable pre-token protocol below the watchlist floor, not a top-N cut.
  // A chosen protocol stays chosen; the floor is never the whole board.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }

  const watchlist = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** A chain's transaction cost, in the words a farmer budgets with. */
function gasFor(chain: string): { perTx: string; weekly: string } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { perTx: 'about $12 of gas', weekly: 'about $12 of gas a week' };
  if (c === 'bitcoin') return { perTx: 'about $3 of network fees', weekly: 'about $3 of network fees a week' };
  return { perTx: 'under $1 of gas', weekly: 'under $1 of gas a week' };
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC on ${name} (${chain}) and leave the deposit earning.`;
  if (c.includes('dex')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain}: half USDC, half the pool's other side.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC through ${name} to ${chain} and hold the bridged balance in its app for a week.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} through ${name} on ${chain} and keep the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, sized so a liquidation is unlikely.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one small position in a market that settles in the next month.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('stable')) return `Mint or hold $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Buy $${capital} of ${name}'s tokenized asset on ${chain} and hold it through one distribution.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('yield') || c.includes('aggregator') || c.includes('farm')) return `Deposit $${capital} into ${name}'s highest-TVL strategy on ${chain} and let it compound.`;
  if (c === 'chain') return `Move $${capital} onto ${name} and use one of its native apps in the first week.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second action: a different kind of activity, so the wallet is not one-note. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow a small amount against the deposit, under 30% of it, and repay it within a week, so the protocol records borrowing as well as lending.`;
  if (c.includes('dex')) return `Route one swap a week through ${name}'s router, even a small one, so the wallet shows trading activity as well as liquidity.`;
  if (c.includes('bridge')) return `Bridge a smaller amount back after a week, so the wallet shows two-way volume instead of a single crossing.`;
  if (c.includes('staking') || c.includes('restak')) return `Restake or re-deposit the first rewards instead of selling them, so the staked balance grows.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge after two weeks and open a fresh one, keeping the margin on the platform throughout.`;
  if (c.includes('prediction')) return `Add to the position once if the market moves against it, rather than opening a new market each time.`;
  if (c.includes('curator') || c.includes('allocator')) return `Move half the deposit to a second ${name} vault after a month, so the wallet touches two of the protocol's products.`;
  if (c.includes('stable')) return `Use the stable asset in one payment or swap each month instead of letting it sit idle.`;
  if (c.includes('rwa')) return `Reinvest the first distribution into the same asset rather than withdrawing it.`;
  if (c.includes('insurance')) return `Renew the cover before it lapses so the policy history stays continuous.`;
  if (c.includes('yield') || c.includes('aggregator') || c.includes('farm')) return `Switch to a second strategy after a month if the first one's yield drops by half.`;
  if (c === 'chain') return `Use one more native app on ${name} in the second month, so the wallet is not tied to a single app.`;
  return `Make one more deposit of the same size after a month, so the wallet shows repeated activity.`;
}

/**
 * A protocol's farm plan: 7 to 9 steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Bridges skip the points step (bridges rarely run one) and multi-chain protocols get a
 * second-chain step.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const isBridge = (p.category ?? '').toLowerCase().includes('bridge');
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'nothing to create, and never share the seed phrase',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas.perTx}`,
      time: '15 minutes to set up',
    },
  ];
  if (!isBridge) {
    steps.push({
      text: `Check ${p.name}'s own site for a points or rewards program and, if one exists, link the same wallet; never follow a link from a chat or a search ad.`,
      cost: 'nothing to check',
      time: '10 minutes',
    });
  }
  steps.push({
    text: secondActionFor(p, capital, chain),
    cost: `no new capital beyond the $${capital}, plus ${gas.perTx}`,
    time: '10 minutes',
  });
  if (p.chains.length >= 2) {
    const second = p.chains[1]!;
    const secondGas = gasFor(second);
    steps.push({
      text: `Repeat the position on ${second} with half the amount ($${Math.round(capital / 2)}), so the wallet is active on two of the protocol's chains.`,
      cost: `$${Math.round(capital / 2)} of capital and ${secondGas.perTx}`,
      time: '15 minutes',
    });
  }
  steps.push(
    {
      text: `Make one qualifying action each week, such as a deposit, a swap, a vote or a borrow, whichever the protocol counts.`,
      cost: gas.weekly,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity lands in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay a fee to claim.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Record the wallet, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  );
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's form for data.js, with the farm plan and the model breakdown. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    on_watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    category_multiples: CATEGORY_MULTIPLES.map((r) => ({ pattern: r.match.source, multiple: r.multiple, why: r.why })),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd as number,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate needs`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
