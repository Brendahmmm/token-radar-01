# Token Radar

A token launch radar for the make.fun bounty `token-radar-01`. It reads a sealed snapshot of
the DefiLlama protocol index, ranks every pre-token protocol by an implied value, and hands the
reader a dashboard with a farm plan for each one.

## What it builds

`main.ts` (Node 22, standard library only, no network) reads the snapshot and writes:

- `board.json` — 226 rows: all 40 watchlist protocols plus every rankable pre-token protocol
  below the $50M watchlist floor (186 early finds). Each row carries its rank, its implied
  value in whole dollars, and a farm plan of 7–9 concrete steps with costs and times.
- `data.js` — the same board, compact, for the dashboard.
- `dashboard/` — a static page (index.html, app.css, app.js, 34 KB): a sortable, searchable,
  filterable board (by category and by chain), a detail dialog for every protocol with the
  model's line-by-line breakdown and its farm plan, a live-token view set apart from the
  ranking, and the model stated in full.
- `screenshots/` — three views of the real dashboard rendered with real data: the board, a
  protocol's detail view, and a filtered view.
- `dossier.json` — the judge's dossier, written by the vendored `vendor/makefun-board.ts`.

## The value model (radar-2)

Implied value follows only from the snapshot's own figures — TVL, seven-day change, and how
long the protocol has run with no token — plus its category and its chains, which the snapshot
also carries. No protocol name is ever special-cased.

```
implied = round( tvl_usd × category_multiple × growth × maturity × chains )
growth   = 1 + 0.6 × change_7d / (50 + |change_7d|)
maturity = 0.70 + 0.30 × age_days / (age_days + 365)
chains   = 1 + 0.02 × min(chains − 1, 10)
```

- **Category multiple (0.15–0.35×).** Different protocol types monetise a dollar of TVL
  differently: lending and derivatives earn fees on every dollar lent or traded (0.35×),
  exchanges, real-world assets and prediction markets sit at 0.30×, curators and insurance at
  0.25×, yield and stable assets at 0.20×, staking at 0.18×, and bridges, which move value
  thinly, at 0.15×. The full table is in `lib/model.ts` and on the dashboard.
- **Growth saturates.** The snapshot's biggest weekly move is +4,448%; a linear response would
  let one outlier own the board. The saturating curve keeps the factor inside (0.4, 1.6): a week
  of +50% growth counts for 1.30×, a week of +150% for 1.45×. An unreported change counts as 0.
- **Age saturates too.** Each year a protocol runs with no token proves a little more, and a
  five-year record is not five times a one-year record. An unlisted age counts as 365 days.
- **Chain breadth is capped** at 1.20×, so a protocol listed on 176 chains cannot dominate.

The model is plain arithmetic throughout — no transcendentals — so the same bytes come out of
any Node build. The dashboard recomputes every row from the same constants and shows the check
in each protocol's detail view: 226 of 226 rows reproduce the board's number.

## The board

- **Watchlist first.** All 40 watchlist protocols are ranked; the watchlist is the floor,
  never the ceiling.
- **Every early find.** Below the floor the board carries every rankable pre-token protocol,
  not a top-N cut by TVL. Rankable excludes exchanges (CEX) and versioned pools (a name ending
  in V2, v2, 2.0), which are a pool of another protocol, not a protocol of their own.
- **Live tokens set aside.** Protocols whose token already trades appear in their own view with
  their market caps — the market's own values, never ranked by the model.
- **Pre-token above the floor, off the watchlist,** are set aside too: the snapshot's own
  watchlist rule leaves them out (wrapped, staked or bridged products of a token that already
  trades, or protocols with a parent protocol), so ranking them as pre-token would misread the
  record. The snapshot says a protocol *records* no token, never that it *has* none.

## Farm plans

Each plan is derived from the protocol's own record — category, chains, TVL, age — and every
step states what it costs and how long it takes:

- capital scales with TVL ($50–$500 a position) and gas with the chain (about $12 a transaction
  on Ethereum, about $3 on Bitcoin, under $1 elsewhere);
- the main action and a second, different action follow the category (lend then borrow, add
  liquidity then route a weekly swap, bridge out then bridge back);
- multi-chain protocols get a second-chain step; bridges skip the points step, since bridges
  rarely run one;
- every plan ends with a weekly-activity step, a hold of 45–90 days, a claim-safety step and a
  farm log.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
node scripts/check.mjs out <snapshot.json>
```

`scripts/check.mjs` verifies the gate's seven rows (dashboard files, board shape, ranking
order, watchlist coverage, farm steps, screenshots, dossier bytes) and the page's recompute of
every row. Two runs write byte-identical output (`diff -r` clean).

## Layout

```
main.ts                  entrypoint: snapshot in, /output out
lib/model.ts             the model, the farm plans, the board
dashboard/               index.html, app.css, app.js (no network, no framework)
screenshots/             1-board.png, 2-detail.png, 3-filtered.png (1280×900)
scripts/check.mjs        the gate self-check
vendor/makefun-board.ts  make.fun's dossier library, vendored verbatim
```

## Licence

MIT — see LICENSE.
