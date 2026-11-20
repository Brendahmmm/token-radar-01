// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a searchable, filterable, sortable table, a per-protocol detail dialog
// with the model's own inputs and the protocol's farm plan, and a live-token view set apart from the
// ranking. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var boardEl = document.getElementById('board');
  if (!DATA || !boardEl) return;

  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model in two functions, rebuilt from the constants data.js carries: the page recomputes a
  // row from the snapshot figures and checks the number board.json carries, so the page's code and
  // the board's data are visibly the same arithmetic.
  function categoryMultiple(cat) {
    if (!cat) return DATA.model.default_multiple;
    for (var i = 0; i < DATA.category_multiples.length; i++) {
      var m = DATA.category_multiples[i];
      if (new RegExp(m.pattern, 'i').test(cat)) return m.multiple;
    }
    return DATA.model.default_multiple;
  }
  function categoryWhy(cat) {
    if (!cat) return 'the default multiple';
    for (var i = 0; i < DATA.category_multiples.length; i++) {
      var m = DATA.category_multiples[i];
      if (new RegExp(m.pattern, 'i').test(cat)) return m.why;
    }
    return 'the default multiple';
  }
  function impliedOf(row) {
    var m = DATA.model;
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growthMult = 1 + m.growth_weight * (g / (m.growth_saturation_pct + Math.abs(g)));
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + m.maturity_range * (Math.max(age, 0) / (Math.max(age, 0) + m.maturity_scale_days));
    var chainMult = 1 + m.chain_step * Math.min(Math.max((row.chains || []).length - 1, 0), m.chain_cap);
    return Math.max(1, Math.round(row.tvl_usd * categoryMultiple(row.category) * growthMult * maturity * chainMult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null
      )
    );
  }

  function signalChip(row) {
    return el('span', { class: 'chip ' + (row.on_watchlist ? 'watch' : 'early'), text: row.on_watchlist ? 'Watchlist' : 'Early' });
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    var countEl = document.getElementById('count');
    if (countEl) countEl.textContent = list.length + ' of ' + DATA.board_size + ' rows shown';
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; syncControls(); writeHash(); render(); } })
      ));
    }
    var max = 1;
    DATA.rows.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, signalChip(r))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Signal' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var countEl = document.getElementById('count');
    if (countEl) countEl.textContent = DATA.live.length + ' live-token protocols';
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'chip live', text: 'Live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'sub', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var formula = document.getElementById('formula');
    if (formula && !formula.hasChildNodes()) {
      formula.appendChild(el('div', null,
        el('span', { class: 'fn', text: 'implied = round( ' }),
        'tvl_usd × category_multiple × growth × maturity × chains',
        el('span', { class: 'fn', text: ' )' })
      ));
      formula.appendChild(el('div', null, 'growth   = 1 + ' + m.growth_weight + ' × change_7d / (' + m.growth_saturation_pct + ' + |change_7d|)'));
      formula.appendChild(el('div', null, 'maturity = ' + m.maturity_floor + ' + ' + m.maturity_range + ' × age_days / (age_days + ' + m.maturity_scale_days + ')'));
      formula.appendChild(el('div', null, 'chains   = 1 + ' + m.chain_step + ' × min(chains − 1, ' + m.chain_cap + ')'));
    }
    var notes = document.getElementById('model-notes');
    if (notes && !notes.textContent) {
      notes.textContent = 'Growth and age both saturate: a week of +4,000% growth is not eighty times a week of +50%, and a five-year record with no token is not five times a one-year record. An unreported seven-day change counts as 0 and an unlisted age as ' + m.unknown_age_days + ' days. The board holds every rankable pre-token protocol below the watchlist floor — the early radar is the whole set, not a top-N cut.';
    }
    var mults = document.getElementById('mults');
    if (mults && !mults.hasChildNodes()) {
      DATA.category_multiples.forEach(function (row) {
        mults.appendChild(el('div', { class: 'mult' },
          el('b', { text: row.pattern.replace(/\|/g, ' · ').replace(/\^|\$/g, '') + ' — ' + row.multiple.toFixed(2) + '×' }),
          el('span', { text: row.why })
        ));
      });
      mults.appendChild(el('div', { class: 'mult' },
        el('b', { text: 'everything else — ' + m.default_multiple.toFixed(2) + '×' }),
        el('span', { text: 'the default multiple' })
      ));
    }
  }

  var dialog = document.getElementById('detail');
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var recomputed = impliedOf(row);
    var match = recomputed === row.implied_value_usd;
    var inner = el('div', { class: 'detail-inner' });
    inner.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('div', { class: 'badges' },
          el('span', { class: 'chip ' + (row.on_watchlist ? 'watch' : 'early'), text: (row.on_watchlist ? 'Watchlist' : 'Early find') + ' · Rank ' + row.rank + ' of ' + DATA.board_size }),
          el('span', { class: 'chip', text: 'no token on record' })
        ),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' · ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + (row.listed_at ? ' · listed ' + row.listed_at : '') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: '✕', onclick: function () { dialog.close(); } })
    ));
    inner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value — the model, line by line' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple (' + categoryWhy(row.category) + ')' }), el('b', { class: 'num', text: row.category_multiple.toFixed(2) + '×' })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: row.growth_multiplier.toFixed(4) + '×' })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: row.maturity_multiplier.toFixed(4) + '×' })),
        el('div', null, el('span', { text: 'Chains (' + (row.chains || []).length + ')' }), el('b', { class: 'num', text: row.chain_multiplier.toFixed(2) + '×' })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'check' },
        'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + ' — ',
        match ? el('b', { text: 'the same number board.json carries.' }) : el('b', { text: 'which differs from the board: the data would be stale.' }),
        ' This is an estimate, not a price.'
      )
    ));
    inner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — ' + row.farm_steps.length + ' steps' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    dialog.appendChild(inner);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function syncControls() {
    var q = document.getElementById('q');
    if (q) q.value = state.q;
    var cat = document.getElementById('category');
    if (cat) cat.value = state.category;
    var chain = document.getElementById('chain');
    if (chain) chain.value = state.chain;
    var pre = document.getElementById('tab-pre');
    var live = document.getElementById('tab-live');
    if (pre) pre.setAttribute('aria-pressed', state.tab === 'pre-token' ? 'true' : 'false');
    if (live) live.setAttribute('aria-pressed', state.tab === 'live' ? 'true' : 'false');
  }

  function fillSelects() {
    var catSel = document.getElementById('category');
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    categories.forEach(function (c) {
      catSel.appendChild(el('option', { value: c, text: c }));
    });
    var chainSel = document.getElementById('chain');
    var counts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
    Object.keys(counts)
      .filter(function (c) { return counts[c] >= 2; })
      .sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); })
      .forEach(function (c) {
        chainSel.appendChild(el('option', { value: c, text: c + ' (' + counts[c] + ')' }));
      });
  }

  function fillStats() {
    var w = document.getElementById('stat-watchlist');
    if (w) w.textContent = DATA.watchlist_size + ' / ' + DATA.watchlist_size;
    var r = document.getElementById('stat-rows');
    if (r) r.textContent = String(DATA.board_size);
    var e = document.getElementById('stat-early');
    if (e) e.textContent = String(DATA.early_size);
    var l = document.getElementById('stat-live');
    if (l) l.textContent = String(DATA.live_size);
    var s = document.getElementById('meta-snapshot');
    if (s) s.textContent = 'Snapshot ' + DATA.as_of;
    var m = document.getElementById('meta-model');
    if (m) m.textContent = DATA.model_version + ' model';
  }

  function wireControls() {
    var q = document.getElementById('q');
    q.addEventListener('input', function () { state.q = q.value; writeHash(); render(); });
    var cat = document.getElementById('category');
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var chain = document.getElementById('chain');
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); render(); });
    document.getElementById('tab-pre').addEventListener('click', function () { state.tab = 'pre-token'; writeHash(); render(); });
    document.getElementById('tab-live').addEventListener('click', function () { state.tab = 'live'; writeHash(); render(); });
  }

  function render() {
    boardEl.textContent = '';
    boardEl.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    var model = document.getElementById('model');
    if (model) model.style.display = state.tab === 'pre-token' ? '' : 'none';
    boardEl.setAttribute('aria-busy', 'false');
    syncControls();
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  fillSelects();
  fillStats();
  modelPanel();
  wireControls();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
