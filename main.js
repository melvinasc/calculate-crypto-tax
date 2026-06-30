// CryptoTax AU — main.js
// All logic consolidated: Store, CSV, Prices, ATO Engine, UI, Exports, App

// ─────────────────────────────────────────────────────────
// THEME (runs immediately to prevent flash)
// ─────────────────────────────────────────────────────────
(function () {
  const t = localStorage.getItem('cryptotax_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
})();

// ─────────────────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────────────────
const Store = {
  transactions: [],

  add(tx) {
    tx.id = Date.now() + Math.random();
    this.transactions.push(tx);
    this.save();
  },

  remove(id) {
    this.transactions = this.transactions.filter(t => t.id !== id);
    this.save();
  },

  forYear(year) {
    const start = new Date(`${year - 1}-07-01T00:00:00`);
    const end   = new Date(`${year}-06-30T23:59:59`);
    return this.transactions.filter(t => {
      const d = new Date(t.date);
      return d >= start && d <= end;
    });
  },

  currentHoldings() {
    const pool = {};
    [...this.transactions]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .forEach(tx => {
        const sym = tx.asset?.toUpperCase();
        if (!sym) return;
        const qty = parseFloat(tx.quantity) || 0;
        pool[sym] = (pool[sym] || 0) + (['buy','nft_buy','staking','mining'].includes(tx.type) ? qty : -qty);
      });
    return Object.fromEntries(Object.entries(pool).filter(([, v]) => v > 0.000001));
  },

  save() {
    try { localStorage.setItem('cryptotax_txns', JSON.stringify(this.transactions)); } catch (_) {}
  },

  load() {
    try {
      const raw = localStorage.getItem('cryptotax_txns');
      if (raw) this.transactions = JSON.parse(raw);
    } catch (_) { this.transactions = []; }
  }
};

// ─────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────
const CSV_TEMPLATE =
  'date,type,asset,quantity,price_aud,fee_aud,exchange,notes\n' +
  '2025-08-10,buy,BTC,0.25,91500,15.00,CoinSpot,\n' +
  '2025-10-22,buy,ETH,1.5,2600,8.00,Binance,\n' +
  '2026-01-05,staking,ETH,0.04,2480,0,Lido,monthly reward\n' +
  '2026-03-18,sell,BTC,0.1,88000,10.00,CoinSpot,\n' +
  '2026-05-02,swap,SOL,20,112,3.00,Phantom,SOL for USDC\n';

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].toLowerCase().split(',').map(h => h.trim());

  const col = (row, ...names) => {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i !== -1 && row[i] !== undefined) return row[i].trim();
    }
    return '';
  };

  return lines.slice(1)
    .filter(l => l.trim())
    .map(l => {
      const row = l.split(',');
      return {
        date:     col(row, 'date', 'datetime', 'time', 'timestamp'),
        type:     normaliseType(col(row, 'type', 'side', 'action', 'transaction type')),
        asset:    col(row, 'asset', 'coin', 'currency', 'symbol').toUpperCase(),
        quantity: parseFloat(col(row, 'quantity', 'amount', 'qty', 'size')) || 0,
        price:    parseFloat(col(row, 'price_aud', 'price', 'rate', 'value')) || 0,
        fee:      parseFloat(col(row, 'fee_aud', 'fee', 'fees', 'commission')) || 0,
        exchange: col(row, 'exchange', 'source', 'platform'),
        notes:    col(row, 'notes', 'note', 'description'),
      };
    });
}

function normaliseType(raw) {
  const r = raw.toLowerCase().trim();
  if (r.includes('stake') || r.includes('reward') || r === 'earn') return 'staking';
  if (r.includes('mine') || r.includes('mining'))                   return 'mining';
  if (r.includes('swap') || r.includes('defi') || r.includes('convert')) return 'swap';
  if (r.includes('nft') && (r.includes('sell') || r.includes('sold')))   return 'nft_sell';
  if (r.includes('nft'))                                            return 'nft_buy';
  if (r.includes('sell') || r.includes('sold') || r === 'ask')     return 'sell';
  return 'buy';
}

// ─────────────────────────────────────────────────────────
// PRICES
// ─────────────────────────────────────────────────────────
const COINGECKO_IDS = {
  BTC:'bitcoin', ETH:'ethereum', SOL:'solana', BNB:'binancecoin',
  XRP:'ripple', ADA:'cardano', DOGE:'dogecoin', MATIC:'matic-network',
  DOT:'polkadot', LINK:'chainlink', AVAX:'avalanche-2', UNI:'uniswap',
  LTC:'litecoin', ATOM:'cosmos',
};

const FALLBACK_AUD = {
  BTC:92200, ETH:2450, SOL:112, BNB:863, XRP:1.62,
  ADA:0.56, DOGE:0.12, MATIC:0.48, DOT:6.20, LINK:11.20,
  AVAX:23.50, UNI:7.10, LTC:98.00, ATOM:5.80,
};

const priceCache = {};
const STALE_MS = 5 * 60 * 1000;

async function fetchLivePrice(symbol) {
  const sym = symbol.toUpperCase();
  const cached = priceCache[sym];
  if (cached && Date.now() - cached.updatedAt < STALE_MS) return cached;

  const id = COINGECKO_IDS[sym];
  if (id) {
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=aud,usd`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const json = await res.json();
        const aud = json[id]?.aud;
        const usd = json[id]?.usd;
        if (aud) return (priceCache[sym] = { aud, usd, updatedAt: Date.now(), live: true });
      }
    } catch (_) {}
  }

  const fallback = FALLBACK_AUD[sym];
  if (fallback) return (priceCache[sym] = { aud: fallback, usd: null, updatedAt: Date.now(), live: false });
  return null;
}

async function fetchPortfolioValues(holdings) {
  const results = {};
  await Promise.all(
    Object.entries(holdings).map(async ([sym, qty]) => {
      const p = await fetchLivePrice(sym);
      if (p) results[sym] = { qty, audPrice: p.aud, audValue: qty * p.aud };
    })
  );
  return results;
}

let priceDebounce = null;
function initPriceAutofill() {
  const assetEl = document.getElementById('txAsset');
  const priceEl = document.getElementById('txPrice');
  const hintEl  = document.getElementById('priceHint');

  assetEl.addEventListener('input', () => {
    clearTimeout(priceDebounce);
    const sym = assetEl.value.trim().toUpperCase();
    if (!sym || sym.length < 2) { if (hintEl) hintEl.textContent = ''; return; }

    priceDebounce = setTimeout(async () => {
      if (priceEl.value) return;
      if (hintEl) hintEl.textContent = 'Fetching…';
      const p = await fetchLivePrice(sym);
      if (p && !priceEl.value) {
        priceEl.value = p.aud.toFixed(2);
        if (hintEl) hintEl.textContent = `≈ A$${p.aud.toLocaleString('en-AU', { maximumFractionDigits: 2 })} (${p.live ? 'live' : 'estimate'})`;
      } else if (hintEl) {
        hintEl.textContent = '';
      }
    }, 500);
  });

  priceEl.addEventListener('input', () => { if (hintEl) hintEl.textContent = ''; });
}

// ─────────────────────────────────────────────────────────
// ATO TAX ENGINE
// ─────────────────────────────────────────────────────────
let taxResults = null;

function computeTax() {
  const year = parseInt(document.getElementById('taxYearSelect').value);
  const txns = Store.forYear(year).sort((a, b) => new Date(a.date) - new Date(b.date));

  const pools = {};
  let ordinaryIncome = 0, capitalGains = 0, capitalLosses = 0, nftNet = 0;
  const cgDetail = [];

  for (const tx of txns) {
    const asset    = tx.asset?.toUpperCase() || '?';
    const qty      = parseFloat(tx.quantity) || 0;
    const price    = parseFloat(tx.price)    || 0;
    const fee      = parseFloat(tx.fee)      || 0;
    const totalAUD = qty * price;
    const isNFT    = tx.type === 'nft_buy' || tx.type === 'nft_sell';
    const txDate   = new Date(tx.date);
    if (!pools[asset]) pools[asset] = [];

    if (tx.type === 'buy' || tx.type === 'nft_buy') {
      pools[asset].push({ date: txDate, qty, costBase: totalAUD + fee });

    } else if (tx.type === 'sell' || tx.type === 'nft_sell') {
      const result = disposeFIFO(pools, asset, qty, totalAUD - fee, txDate, isNFT);
      cgDetail.push({ ...result, asset, type: tx.type, date: tx.date });
      if (isNFT) nftNet += result.gain;
      else if (result.gain >= 0) capitalGains  += result.gain;
      else                       capitalLosses += result.gain;

    } else if (tx.type === 'swap') {
      const result = disposeFIFO(pools, asset, qty, totalAUD - fee, txDate, false);
      cgDetail.push({ ...result, asset, type: 'swap', date: tx.date });
      if (result.gain >= 0) capitalGains  += result.gain;
      else                  capitalLosses += result.gain;

    } else if (tx.type === 'staking' || tx.type === 'mining') {
      ordinaryIncome += totalAUD;
      pools[asset].push({ date: txDate, qty, costBase: totalAUD });
    }
  }

  taxResults = { ordinaryIncome, capitalGains, capitalLosses, nftNet, cgDetail, year };

  const fyEl = document.getElementById('summaryFY');
  if (fyEl) fyEl.textContent = `${year - 1}–${String(year).slice(2)}`;

  renderSummary();
  return taxResults;
}

function disposeFIFO(pools, asset, qtyToSell, proceedsAUD, txDate, isNFT) {
  const pool = pools[asset] || [];
  let remaining = qtyToSell, totalCost = 0, hasDiscount = false;

  while (remaining > 0 && pool.length > 0) {
    const lot  = pool[0];
    const take = Math.min(remaining, lot.qty);
    const cost = (take / lot.qty) * lot.costBase;
    totalCost += cost;
    if (!isNFT && (txDate - lot.date) / 86400000 > 365) hasDiscount = true;
    lot.qty      -= take;
    lot.costBase -= cost;
    remaining    -= take;
    if (lot.qty <= 0.000001) pool.shift();
  }

  let gain = proceedsAUD - totalCost;
  const discountApplied = hasDiscount && gain > 0;
  if (discountApplied) gain *= 0.5;
  return { gain, totalCost, proceedsAUD, discountApplied };
}

function renderSummary() {
  const r = taxResults;
  const aud = n => '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const netCG = r.capitalGains + r.capitalLosses;

  const set = (id, text, color) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    if (color) el.style.color = color;
  };

  set('netCG', (netCG < 0 ? '-' : '') + aud(netCG), netCG < 0 ? 'var(--red)' : 'var(--green)');
  set('ordinaryIncome', aud(r.ordinaryIncome));
  set('capitalLoss', aud(r.capitalLosses));
  set('nftGain', (r.nftNet < 0 ? '-' : '') + aud(r.nftNet), r.nftNet < 0 ? 'var(--red)' : 'var(--green)');

  const discEl = document.getElementById('cgDiscount');
  if (discEl) discEl.textContent = r.cgDetail.some(d => d.discountApplied)
    ? '50% CGT discount applied' : '';

  const breakdown = document.getElementById('cgBreakdown');
  if (!breakdown) return;
  if (!r.cgDetail.length) {
    breakdown.innerHTML = '<p style="color:var(--text-muted);font-size:.875rem">No disposal events found for this tax year.</p>';
    return;
  }
  breakdown.innerHTML = r.cgDetail.map(d => `
    <div class="cg-row">
      <span class="asset">${d.asset}</span>
      <span style="color:var(--text-muted);font-size:.8rem">${d.date}</span>
      <span style="color:var(--text-muted);font-size:.8rem">Cost $${d.totalCost.toFixed(2)} → Proceeds $${d.proceedsAUD.toFixed(2)}</span>
      ${d.discountApplied ? '<span class="discount-tag">50% discount</span>' : ''}
      <span class="gain ${d.gain >= 0 ? 'positive' : 'negative'}">${d.gain >= 0 ? '+' : ''}$${d.gain.toFixed(2)}</span>
    </div>
  `).join('');
}

// ─────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────
function goToStep(n) {
  document.querySelectorAll('.step-panel').forEach((p, i) => p.classList.toggle('active', i + 1 === n));
  document.querySelectorAll('.wizard-step').forEach((btn, i) => {
    btn.classList.toggle('active', i + 1 === n);
    btn.classList.toggle('done', i + 1 < n);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (n === 2) renderReviewTable();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

function renderTxList() {
  const year   = parseInt(document.getElementById('taxYearSelect').value);
  const txns   = Store.forYear(year);
  const listEl = document.getElementById('txList');
  const header = document.getElementById('txListHeader');
  const nextBtn = document.getElementById('step1Next');

  if (!txns.length) {
    listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>No transactions yet — add one above, upload a CSV, or press "Load Demo Data".</p></div>';
    header.hidden = nextBtn.hidden = true;
    updatePortfolioPanel();
    return;
  }

  header.hidden = nextBtn.hidden = false;
  document.getElementById('txCount').textContent = txns.length;

  const rows = txns.map(tx => `
    <tr>
      <td>${tx.date}</td>
      <td><span class="tx-type-badge type-${tx.type}">${tx.type}</span></td>
      <td><strong>${tx.asset}</strong></td>
      <td class="mono">${parseFloat(tx.quantity).toLocaleString('en-AU', { maximumSignificantDigits: 8 })}</td>
      <td class="mono">$${parseFloat(tx.price).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td class="mono">$${parseFloat(tx.fee || 0).toFixed(2)}</td>
      <td style="color:var(--text-muted)">${tx.exchange || '—'}</td>
      <td><button class="btn-delete" onclick="deleteTx(${tx.id})">✕</button></td>
    </tr>
  `).join('');

  listEl.innerHTML = `
    <div class="tx-table-wrap">
      <table class="tx-table">
        <thead><tr>
          <th>Date</th><th>Type</th><th>Asset</th>
          <th>Quantity</th><th>Price (AUD)</th><th>Fee (AUD)</th>
          <th>Exchange</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  updatePortfolioPanel();
}

function deleteTx(id) {
  Store.remove(id);
  renderTxList();
  showToast('Transaction removed');
}

function renderReviewTable() {
  const year = parseInt(document.getElementById('taxYearSelect').value);
  const txns = Store.forYear(year);
  const el   = document.getElementById('reviewTable');

  if (!txns.length) {
    el.innerHTML = '<p style="color:var(--text-muted)">No transactions to review.</p>';
    return;
  }

  const typeOptions = [
    ['buy','Buy (Acquisition)'], ['sell','Sell (Disposal)'], ['swap','Swap / DeFi'],
    ['staking','Staking Reward'], ['mining','Mining Income'],
    ['nft_buy','NFT Purchase'], ['nft_sell','NFT Sale'],
  ];

  const opts = (cur) => typeOptions.map(([v, l]) =>
    `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`
  ).join('');

  const rows = txns.map(tx => {
    const val  = (parseFloat(tx.quantity) * parseFloat(tx.price)).toFixed(2);
    const isCGT = ['sell','swap','nft_sell'].includes(tx.type);
    return `
      <tr>
        <td>${tx.date}</td>
        <td><strong>${tx.asset}</strong></td>
        <td class="mono">${parseFloat(tx.quantity).toLocaleString()}</td>
        <td class="mono">$${parseFloat(val).toLocaleString('en-AU', { minimumFractionDigits: 2 })}</td>
        <td><select onchange="updateTxType(${tx.id}, this.value)">${opts(tx.type)}</select></td>
        <td style="color:${isCGT ? 'var(--violet)' : 'var(--text-muted)'}">${isCGT ? '✓ CGT Event' : '—'}</td>
      </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="review-wrapper">
      <table class="review-table">
        <thead><tr>
          <th>Date</th><th>Asset</th><th>Qty</th><th>AUD Value</th>
          <th>ATO Category</th><th>CGT Event?</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function updateTxType(id, newType) {
  const tx = Store.transactions.find(t => t.id === id);
  if (tx) { tx.type = newType; Store.save(); }
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

function initDrop() {
  const zone = document.getElementById('dropZone');
  const file = document.getElementById('csvFile');
  if (!zone || !file) return;

  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover'); handleCSVFile(e.dataTransfer.files[0]); });
  zone.addEventListener('click', () => file.click());
  file.addEventListener('change',    () => handleCSVFile(file.files[0]));
}

function handleCSVFile(f) {
  if (!f) return;
  const reader = new FileReader();
  reader.onload = e => {
    const txns = parseCSV(e.target.result);
    if (!txns.length) { showToast('No transactions found in CSV'); return; }
    txns.forEach(tx => Store.add(tx));
    renderTxList();
    showToast(`Imported ${txns.length} transactions`);
    const preview = document.getElementById('csvPreview');
    if (preview) { preview.hidden = false; preview.textContent = `✓ Imported ${txns.length} rows from ${f.name}`; }
  };
  reader.readAsText(f);
}

async function updatePortfolioPanel() {
  const panel = document.getElementById('portfolioPanel');
  if (!panel) return;
  const holdings = Store.currentHoldings();
  if (!Object.keys(holdings).length) { panel.hidden = true; return; }

  panel.hidden = false;
  panel.innerHTML = `
    <div class="section-label">Current Holdings <span style="color:var(--teal);font-size:0.7rem;margin-left:8px">Live prices</span></div>
    <div class="holdings-grid" id="holdingsGrid"><div style="color:var(--text-muted);font-size:.85rem;padding:8px">Fetching prices…</div></div>`;

  const values = await fetchPortfolioValues(holdings);
  const totalAUD = Object.values(values).reduce((s, v) => s + v.audValue, 0);
  const grid = document.getElementById('holdingsGrid');
  if (!grid) return;

  grid.innerHTML = Object.entries(values).map(([sym, v]) => `
    <div class="holding-row">
      <span class="holding-sym">${sym}</span>
      <span class="holding-qty">${v.qty.toLocaleString('en-AU', { maximumSignificantDigits: 6 })}</span>
      <span class="holding-price">@ A$${v.audPrice.toLocaleString('en-AU', { maximumFractionDigits: 2 })}</span>
      <span class="holding-value">A$${v.audValue.toLocaleString('en-AU', { maximumFractionDigits: 2 })}</span>
    </div>`).join('') +
    `<div class="holding-total"><span>Total</span><span>A$${totalAUD.toLocaleString('en-AU', { maximumFractionDigits: 2 })}</span></div>`;
}

// ─────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────
function downloadBlob(content, filename, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

function initExports() {
  const on = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
  on('exportCSV',        exportATOSummaryCSV);
  on('exportFullCSV',    exportFullLogCSV);
  on('exportPDF',        exportPDF);
  on('exportJSON',       exportJSON);
  on('downloadTemplate', () => { downloadBlob(CSV_TEMPLATE, 'cryptotax-au-template.csv'); showToast('Template downloaded'); });
  on('loadJSON',         () => document.getElementById('jsonFile')?.click());

  document.getElementById('jsonFile')?.addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      try {
        const d = JSON.parse(ev.target.result);
        if (d.transactions) { Store.transactions = d.transactions; Store.save(); renderTxList(); showToast(`Loaded ${d.transactions.length} transactions`); }
      } catch (_) { showToast('Invalid JSON file'); }
    };
    r.readAsText(f);
  });
}

function exportATOSummaryCSV() {
  if (!taxResults) { showToast('Calculate tax first (Step 3)'); return; }
  const r = taxResults;
  const netCG = r.capitalGains + r.capitalLosses;
  const rows = [
    ['CryptoTax AU — ATO Capital Gains Summary'],
    [`Tax Year: FY ${r.year - 1}–${String(r.year).slice(2)}`],
    [],
    ['Category','Amount (AUD)'],
    ['Gross Capital Gains', r.capitalGains.toFixed(2)],
    ['Capital Losses', r.capitalLosses.toFixed(2)],
    ['Net Capital Gain', netCG.toFixed(2)],
    ['Ordinary Income (Staking/Mining)', r.ordinaryIncome.toFixed(2)],
    ['NFT Net Gain/Loss', r.nftNet.toFixed(2)],
    [],
    ['Date','Asset','Type','Proceeds (AUD)','Cost Base (AUD)','Gain/Loss (AUD)','50% Discount'],
    ...r.cgDetail.map(d => [d.date, d.asset, d.type, d.proceedsAUD.toFixed(2), d.totalCost.toFixed(2), d.gain.toFixed(2), d.discountApplied ? 'Yes' : 'No']),
  ];
  downloadBlob(rows.map(r => r.join(',')).join('\n'), `cryptotax-au-summary-fy${r.year}.csv`);
  showToast('ATO Summary CSV downloaded');
}

function exportFullLogCSV() {
  const year = parseInt(document.getElementById('taxYearSelect').value);
  const txns = Store.forYear(year);
  const rows = [
    ['date','type','asset','quantity','price_aud','fee_aud','total_aud','exchange','notes'],
    ...txns.map(t => [t.date, t.type, t.asset, t.quantity, t.price, t.fee || 0,
      (parseFloat(t.quantity) * parseFloat(t.price)).toFixed(2), t.exchange || '', t.notes || '']),
  ];
  downloadBlob(rows.map(r => r.join(',')).join('\n'), `cryptotax-au-log-fy${year}.csv`);
  showToast('Full log downloaded');
}

function exportPDF() {
  if (!taxResults) { showToast('Calculate tax first (Step 3)'); return; }
  const r = taxResults;
  const aud = n => '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const netCG = r.capitalGains + r.capitalLosses;
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head>
    <title>CryptoTax AU FY${r.year - 1}–${String(r.year).slice(2)}</title>
    <style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;color:#222}h1{font-size:1.4rem;border-bottom:2px solid #f7931a;padding-bottom:8px}h2{font-size:1rem;margin-top:24px;color:#444}table{width:100%;border-collapse:collapse;font-size:.875rem;margin-top:8px}th{background:#f5f5f5;padding:8px;text-align:left}td{padding:8px;border-bottom:1px solid #eee}.footer{margin-top:40px;font-size:.75rem;color:#888;border-top:1px solid #eee;padding-top:12px}.hi{font-weight:700;font-size:1.1rem}</style>
    </head><body>
    <h1>🪙 CryptoTax AU — FY ${r.year - 1}–${String(r.year).slice(2)} Tax Report</h1>
    <p><strong>Generated:</strong> ${new Date().toLocaleDateString('en-AU')}</p>
    <h2>Summary</h2>
    <table>
      <tr><th>Category</th><th>Amount</th></tr>
      <tr><td>Gross Capital Gains</td><td>${aud(r.capitalGains)}</td></tr>
      <tr><td>Capital Losses</td><td>−${aud(Math.abs(r.capitalLosses))}</td></tr>
      <tr><td><strong>Net Capital Gain/Loss</strong></td><td class="hi">${netCG < 0 ? '−' : ''}${aud(netCG)}</td></tr>
      <tr><td>Ordinary Income (Staking/Mining)</td><td>${aud(r.ordinaryIncome)}</td></tr>
      <tr><td>NFT Net Gain/Loss</td><td>${r.nftNet < 0 ? '−' : ''}${aud(r.nftNet)}</td></tr>
    </table>
    <h2>Disposal Events</h2>
    <table>
      <tr><th>Date</th><th>Asset</th><th>Type</th><th>Proceeds</th><th>Cost Base</th><th>Gain/Loss</th><th>Discount</th></tr>
      ${r.cgDetail.map(d => `<tr><td>${d.date}</td><td>${d.asset}</td><td>${d.type}</td><td>$${d.proceedsAUD.toFixed(2)}</td><td>$${d.totalCost.toFixed(2)}</td><td style="color:${d.gain >= 0 ? 'green' : 'red'}">${d.gain >= 0 ? '+' : ''}$${d.gain.toFixed(2)}</td><td>${d.discountApplied ? '50%' : '—'}</td></tr>`).join('')}
    </table>
    <div class="footer">FIFO cost-base · 50% CGT discount (>12 months) · Staking/mining as ordinary income · Swaps as CGT events (s104-10 ITAA97). For reference only — verify with a registered tax agent.</div>
    </body></html>`);
  win.document.close();
  win.print();
  showToast('PDF ready to print');
}

function exportJSON() {
  downloadBlob(JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), transactions: Store.transactions }, null, 2),
    'cryptotax-au-backup.json', 'application/json');
  showToast('Backup saved');
}

// ─────────────────────────────────────────────────────────
// DEMO DATA
// ─────────────────────────────────────────────────────────
async function loadDemoData() {
  const [btcP, ethP, solP] = await Promise.all([fetchLivePrice('BTC'), fetchLivePrice('ETH'), fetchLivePrice('SOL')]);
  const btc = btcP?.aud || 92200, eth = ethP?.aud || 2450, sol = solP?.aud || 112;

  [
    { date:'2023-08-15', type:'buy',     asset:'BTC', quantity:0.3,   price:41200,              fee:12,   exchange:'CoinSpot' },
    { date:'2023-11-10', type:'buy',     asset:'ETH', quantity:2.0,   price:2700,               fee:8.5,  exchange:'Binance' },
    { date:'2024-01-20', type:'buy',     asset:'SOL', quantity:50,    price:128,                fee:4,    exchange:'Binance' },
    { date:'2024-03-01', type:'staking', asset:'ETH', quantity:0.03,  price:5900,               fee:0,    exchange:'Lido' },
    { date:'2024-09-05', type:'buy',     asset:'BTC', quantity:0.15,  price:97000,              fee:18,   exchange:'CoinSpot' },
    { date:'2024-11-18', type:'sell',    asset:'SOL', quantity:20,    price:370,                fee:5,    exchange:'Binance' },
    { date:'2025-02-14', type:'staking', asset:'ETH', quantity:0.04,  price:4200,               fee:0,    exchange:'Lido' },
    { date:'2025-04-10', type:'swap',    asset:'ETH', quantity:0.5,   price:3800,               fee:3.5,  exchange:'Uniswap' },
    { date:'2025-05-22', type:'buy',     asset:'ETH', quantity:1.0,   price:3950,               fee:6,    exchange:'Coinbase' },
    { date:'2025-06-28', type:'mining',  asset:'BTC', quantity:0.002, price:152000,             fee:0,    exchange:'self' },
    { date:'2025-08-10', type:'buy',     asset:'BTC', quantity:0.25,  price:Math.round(btc*.97),fee:15,   exchange:'CoinSpot' },
    { date:'2025-10-04', type:'staking', asset:'ETH', quantity:0.05,  price:Math.round(eth*1.05),fee:0,   exchange:'Lido' },
    { date:'2026-01-15', type:'sell',    asset:'BTC', quantity:0.1,   price:Math.round(btc*1.02),fee:12,  exchange:'CoinSpot' },
    { date:'2026-02-28', type:'nft_buy', asset:'ETH', quantity:0.3,   price:Math.round(eth*.99),fee:2,    exchange:'OpenSea' },
    { date:'2026-04-20', type:'swap',    asset:'SOL', quantity:15,    price:Math.round(sol*1.01),fee:2.5, exchange:'Jupiter' },
    { date:'2026-06-01', type:'sell',    asset:'ETH', quantity:0.8,   price:Math.round(eth*.98),fee:7,    exchange:'Binance' },
  ].forEach(tx => Store.add(tx));

  document.getElementById('taxYearSelect').value = '2026';
  renderTxList();
  showToast('✓ Loaded demo data — FY23–26');
}

async function simulateAPIImport(exchange) {
  const [btcP, ethP] = await Promise.all([fetchLivePrice('BTC'), fetchLivePrice('ETH')]);
  const btc = btcP?.aud || 92200, eth = ethP?.aud || 2450;
  [
    { date:'2025-09-12', type:'buy',     asset:'BTC', quantity:0.05, price:Math.round(btc*.98), fee:8,   exchange },
    { date:'2025-12-03', type:'buy',     asset:'ETH', quantity:1.2,  price:Math.round(eth*1.02),fee:5,   exchange },
    { date:'2026-02-14', type:'sell',    asset:'ETH', quantity:0.5,  price:Math.round(eth*.97), fee:4,   exchange },
    { date:'2026-03-30', type:'staking', asset:'ETH', quantity:0.02, price:Math.round(eth),     fee:0,   exchange },
    { date:'2026-05-10', type:'swap',    asset:'BTC', quantity:0.02, price:Math.round(btc*1.01),fee:2.5, exchange },
  ].forEach(tx => Store.add(tx));
  document.getElementById('taxYearSelect').value = '2026';
  renderTxList();
  showToast(`✓ Imported from ${exchange} (demo)`);
}

// ─────────────────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  Store.load();
  initTabs();
  initDrop();
  initExports();
  initPriceAutofill();
  initTheme();
  renderTxList();
  updateLivePriceTicker();

  // Manual entry
  document.getElementById('addTxBtn').addEventListener('click', () => {
    const get = id => document.getElementById(id).value;
    const date = get('txDate'), type = get('txType'),
          asset = get('txAsset').trim().toUpperCase(),
          quantity = get('txQty'), price = get('txPrice'),
          fee = get('txFee'), notes = get('txNotes').trim();

    if (!date || !asset || !quantity || !price) { showToast('Fill in Date, Asset, Quantity and Price'); return; }
    if (parseFloat(quantity) <= 0) { showToast('Quantity must be positive'); return; }
    if (parseFloat(price) <= 0)    { showToast('Price must be positive'); return; }

    Store.add({ date, type, asset, quantity: parseFloat(quantity), price: parseFloat(price), fee: parseFloat(fee) || 0, exchange: notes, notes });
    renderTxList();
    showToast(`✓ Added ${type} — ${quantity} ${asset}`);
    ['txAsset','txQty','txPrice','txFee','txNotes'].forEach(id => document.getElementById(id).value = '');
    const hint = document.getElementById('priceHint');
    if (hint) hint.textContent = '';
  });

  // Exchange API
  let activeExchange = '';
  document.querySelectorAll('.btn-connect').forEach(btn => {
    btn.addEventListener('click', () => {
      activeExchange = btn.closest('.exchange-card').dataset.exchange;
      document.getElementById('apiModalTitle').textContent =
        `Connect ${activeExchange.charAt(0).toUpperCase() + activeExchange.slice(1)}`;
      document.getElementById('apiModal').hidden = false;
    });
  });
  document.getElementById('apiCancel').addEventListener('click', () => { document.getElementById('apiModal').hidden = true; });
  document.getElementById('apiImport').addEventListener('click', () => {
    const key = document.getElementById('apiKey').value.trim();
    const sec = document.getElementById('apiSecret').value.trim();
    if (!key || !sec) { showToast('Enter both API key and secret'); return; }
    simulateAPIImport(activeExchange);
    document.getElementById('apiKey').value = document.getElementById('apiSecret').value = '';
    document.getElementById('apiModal').hidden = true;
  });

  // Other controls
  document.getElementById('clearAll').addEventListener('click', () => {
    if (!confirm('Remove all transactions for this tax year?')) return;
    const year = parseInt(document.getElementById('taxYearSelect').value);
    Store.transactions = Store.transactions.filter(t => {
      const d = new Date(t.date);
      return d < new Date(`${year - 1}-07-01`) || d > new Date(`${year}-06-30`);
    });
    Store.save(); renderTxList(); showToast('Cleared');
  });

  document.getElementById('taxYearSelect').addEventListener('change', renderTxList);

  document.querySelectorAll('.wizard-step').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = parseInt(btn.dataset.step);
      if (n >= 2 && !Store.transactions.length) { showToast('Add some transactions first'); return; }
      if (n === 3) computeTax();
      goToStep(n);
    });
  });

  document.getElementById('loadDemoBtn')?.addEventListener('click', loadDemoData);
  document.getElementById('txDate').valueAsDate = new Date();
});

// ─────────────────────────────────────────────────────────
// THEME
// ─────────────────────────────────────────────────────────
function initTheme() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  const current = () => document.documentElement.getAttribute('data-theme') || 'dark';
  const apply = theme => {
    document.documentElement.setAttribute('data-theme', theme);
    btn.textContent = theme === 'light' ? '🌙' : '☀️';
    localStorage.setItem('cryptotax_theme', theme);
  };
  apply(current());
  btn.addEventListener('click', () => apply(current() === 'dark' ? 'light' : 'dark'));
}

// ─────────────────────────────────────────────────────────
// PRICE TICKER
// ─────────────────────────────────────────────────────────
async function updateLivePriceTicker() {
  const el = document.getElementById('priceTicker');
  if (!el) return;
  const results = await Promise.all(
    ['BTC','ETH','SOL','XRP','BNB'].map(async s => {
      const p = await fetchLivePrice(s);
      return p ? `${s} A$${p.aud.toLocaleString('en-AU', { maximumFractionDigits: 0 })}` : null;
    })
  );
  el.textContent = results.filter(Boolean).join('  ·  ') || '';
}
