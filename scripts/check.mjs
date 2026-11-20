// Self-check for a token-radar output directory: the gate's seven rows, plus the page's own
// recompute of every row. Run from the repository root:
//   node scripts/check.mjs out [snapshot.json]
// Exits 0 when every check passes, 1 otherwise. Node standard library only.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const out = process.argv[2] || 'out';
const snapshotPath = process.argv[3] || '../kits/token-radar-01-kit/input/snapshot.json';
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const snapSlugs = new Set(snapshot.protocols.map((p) => p.slug));
const snapBySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// 1. dashboard_files: index.html + >=1 css + >=1 js, <=400 files, <=4 MiB, valid names,
//    no http(s) address in any attribute, style body, CSS file or JS import specifier.
{
  const dir = join(out, 'dashboard');
  const files = readdirSync(dir).filter((f) => !f.startsWith('.'));
  const bytes = files.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
  const hasHtml = files.includes('index.html');
  const hasCss = files.some((f) => f.endsWith('.css'));
  const hasJs = files.some((f) => f.endsWith('.js'));
  const namesOk = files.every((f) => /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(f));
  let urlHits = [];
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    // A URL in a comment or visible text is allowed; an attribute value, a <style> body, a CSS
    // file or a JS import specifier is not. This build carries no URL anywhere in dashboard/,
    // so any occurrence is flagged for a human to judge.
    const hits = [...text.matchAll(/https?:\/\/[^\s"'`]+/g)].map((m) => `${f}: ${m[0].slice(0, 60)}`);
    urlHits = urlHits.concat(hits);
  }
  check('dashboard_files', hasHtml && hasCss && hasJs && files.length <= 400 && bytes <= 4_194_304 && namesOk && urlHits.length === 0,
    `${files.length} files, ${bytes} bytes, html=${hasHtml} css=${hasCss} js=${hasJs}, url hits=${urlHits.length}${urlHits.length ? ' ' + urlHits.join('; ') : ''}`);
}

// 2+3. board_file + sorted_by_value: shape, ranks 1..N, non-increasing values, not all equal.
const board = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8'));
const rows = board.rows;
{
  const size = statSync(join(out, 'board.json')).size;
  const shapeOk = Array.isArray(rows) && rows.length >= 100 && rows.length <= 4000 && size <= 8 * 1024 * 1024;
  const seen = new Set();
  let bad = null;
  for (const r of rows) {
    if (!snapSlugs.has(r.slug)) { bad = `${r.slug}: slug not in snapshot`; break; }
    if (seen.has(r.slug)) { bad = `${r.slug}: duplicate slug`; break; }
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) { bad = `${r.slug}: empty name`; break; }
    if (!Number.isSafeInteger(r.rank) || r.rank < 1) { bad = `${r.slug}: bad rank`; break; }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) { bad = `${r.slug}: bad implied value`; break; }
  }
  check('board_file', shapeOk && bad === null, `${rows.length} rows, ${size} bytes${bad ? ', ' + bad : ''}`);
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  const ranksOk = ranks.every((r, i) => r === i + 1);
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  const orderedOk = byRank.every((r, i) => i === 0 || r.implied_value_usd <= byRank[i - 1].implied_value_usd);
  const notAllEqual = byRank[0].implied_value_usd !== byRank[byRank.length - 1].implied_value_usd;
  check('sorted_by_value', ranksOk && orderedOk && notAllEqual,
    `ranks 1..${rows.length} exact=${ranksOk}, non-increasing=${orderedOk}, not all equal=${notAllEqual}`);
}

// 4. coverage: every watchlist slug present; at least 60 rows outside the watchlist.
{
  const have = new Set(rows.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !have.has(s));
  const outside = rows.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  check('coverage', missing.length === 0 && outside >= 60,
    `watchlist ${snapshot.watchlist.length - missing.length}/${snapshot.watchlist.length}, ${outside} rows outside it`);
}

// 5. farm_steps: 3..12 strings, each 20..600 chars trimmed.
{
  let bad = null;
  for (const r of rows) {
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) { bad = `${r.slug}: ${r.farm_steps?.length} steps`; break; }
    for (const s of r.farm_steps) {
      const n = s.trim().length;
      if (n < 20 || n > 600) { bad = `${r.slug}: step of ${n} chars`; break; }
    }
    if (bad) break;
  }
  const counts = [...new Set(rows.map((r) => r.farm_steps.length))].sort((a, b) => a - b);
  check('farm_steps', bad === null, `step counts ${counts.join(', ')}${bad ? ', ' + bad : ''}`);
}

// 6. screenshots: 3..4 images, each <=512 KiB, whole PNG/JPEG, long side <=1440, short side >=800.
{
  const dir = join(out, 'screenshots');
  const files = readdirSync(dir).filter((f) => !f.startsWith('.'));
  let bad = null;
  const dims = [];
  for (const f of files) {
    const bytes = readFileSync(join(dir, f));
    if (bytes.length > 524_288) { bad = `${f}: ${bytes.length} bytes`; break; }
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!isPng && !isJpeg) { bad = `${f}: not a PNG or JPEG`; break; }
    let w = 0, h = 0;
    if (isPng) { w = bytes.readUInt32BE(16); h = bytes.readUInt32BE(20); }
    if (isJpeg) {
      // Walk the markers to the first SOF (0xC0-0xCF except 0xC4/0xC8/0xCC).
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const marker = bytes[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          h = bytes.readUInt16BE(i + 5); w = bytes.readUInt16BE(i + 7); break;
        }
        i += 2 + bytes.readUInt16BE(i + 2);
      }
    }
    dims.push(`${f} ${w}x${h} ${bytes.length}B`);
    if (Math.max(w, h) > 1440 || Math.min(w, h) < 800) { bad = `${f}: ${w}x${h} out of bounds`; break; }
  }
  check('screenshots', files.length >= 3 && files.length <= 4 && bad === null, `${files.length} images: ${dims.join('; ')}${bad ? ', ' + bad : ''}`);
}

// 7. dossier_matches: byte-for-byte what buildDossier writes, at most 1.5 MiB.
{
  const onDisk = readFileSync(join(out, 'dossier.json'));
  const rebuilt = buildDossier(out, { text_max_bytes: 65536 });
  const equal = Buffer.compare(Buffer.from(onDisk), Buffer.from(rebuilt)) === 0;
  const doc = JSON.parse(onDisk.toString('utf8'));
  check('dossier_matches', equal && onDisk.length <= 1_572_864,
    `${onDisk.length} bytes, byte-identical to a fresh buildDossier=${equal}, text ${Buffer.byteLength(doc.text)} bytes`);
}

// Extra: the page's recompute. Rebuild implied values from the snapshot figures with the same
// arithmetic the dashboard runs (patterns from data.js) and compare against board.json.
{
  const dataText = readFileSync(join(out, 'data.js'), 'utf8');
  const radar = JSON.parse(dataText.slice('window.RADAR='.length).replace(/;\s*$/, ''));
  const m = radar.model;
  const mult = (cat) => {
    if (!cat) return m.default_multiple;
    for (const row of radar.category_multiples) if (new RegExp(row.pattern, 'i').test(cat)) return row.multiple;
    return m.default_multiple;
  };
  const ageDays = (listed) => {
    if (!listed) return null;
    return Math.max(0, Math.floor((Date.parse(`${radar.as_of}T00:00:00Z`) - Date.parse(`${listed}T00:00:00Z`)) / 86_400_000));
  };
  let mismatches = 0;
  for (const r of rows) {
    const p = snapBySlug.get(r.slug);
    const g = p.change_7d ?? 0;
    const growth = 1 + m.growth_weight * (g / (m.growth_saturation_pct + Math.abs(g)));
    const age = ageDays(p.listed_at) ?? m.unknown_age_days;
    const maturity = m.maturity_floor + m.maturity_range * (Math.max(age, 0) / (Math.max(age, 0) + m.maturity_scale_days));
    const chain = 1 + m.chain_step * Math.min(Math.max(p.chains.length - 1, 0), m.chain_cap);
    const implied = Math.max(1, Math.round(p.tvl_usd * mult(p.category) * growth * maturity * chain));
    if (implied !== r.implied_value_usd) mismatches++;
  }
  check('page_recompute', mismatches === 0, `${rows.length - mismatches}/${rows.length} rows recompute to the board's number`);
}

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
