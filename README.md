# 🪙 CryptoTax AU

> **Free, open-source crypto tax calculator for Australian investors — runs entirely in your browser.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/Deployed-GitHub%20Pages-blue)](https://YOUR_USERNAME.github.io/crypto-tax-au)

---

## Features

| Feature | Details |
|---|---|
| **ATO-compliant** | FIFO cost-base, 50% CGT discount (>12 months), staking/mining as ordinary income, crypto↔crypto swaps as CGT events (s104-10 ITAA97) |
| **All transaction types** | Buys, sells, DeFi swaps, staking rewards, mining income, NFT trades |
| **Three data input methods** | Manual entry form, CSV upload, Exchange API (Binance, CoinSpot, Swyftx, Coinbase, Kraken) |
| **Multiple export formats** | ATO Summary CSV, Full Transaction Log CSV, Print-ready PDF, JSON backup |
| **Privacy-first** | 100% client-side — no servers, no signups, no data leaves your browser |
| **Supported tax years** | FY 2021–22, 2022–23, 2023–24 |

---

## Deploy to GitHub Pages (5 minutes)

```bash
# 1. Fork or clone this repo
git clone https://github.com/YOUR_USERNAME/crypto-tax-au.git
cd crypto-tax-au

# 2. Push to GitHub
git add .
git commit -m "Initial deploy"
git push origin main

# 3. Enable GitHub Pages
# Go to → Settings → Pages → Source: main branch / root
```

Your app will be live at `https://YOUR_USERNAME.github.io/crypto-tax-au`

---

## CSV Format

Upload a CSV with these columns (download the template from the app):

```
date,type,asset,quantity,price_aud,fee_aud,exchange,notes
2024-03-15,buy,BTC,0.5,65000,12.50,CoinSpot,
2024-04-02,sell,BTC,0.2,72000,8.00,CoinSpot,
2024-05-10,staking,ETH,0.15,3800,0,Lido,monthly reward
2024-06-01,swap,SOL,10,180,2.50,Phantom,SOL for USDC
```

**Supported exchanges (auto-detected):** Binance, CoinSpot, Swyftx, Kraken, Coinbase, or any generic format.

**Transaction types:** `buy`, `sell`, `swap`, `staking`, `mining`, `nft_buy`, `nft_sell`

---

## ATO Rules Applied

- **CGT Discount:** 50% discount on assets held longer than 12 months (individuals)
- **Cost Base Method:** FIFO (First In, First Out)
- **Crypto-to-Crypto Swaps:** Treated as disposal + acquisition (CGT Event A1, s104-10 ITAA97)
- **Staking / Mining:** Taxed as ordinary income at fair market value on date of receipt; added to pool at that cost-base for future CGT
- **NFTs:** Treated as CGT assets; same rules as regular crypto

> ⚠️ **Disclaimer:** This tool is for informational purposes. Always verify with a registered tax agent or BAS agent. ATO rules change — check [ato.gov.au](https://www.ato.gov.au/individuals-and-families/investments-and-assets/crypto-asset-investments) for the latest guidance.

---

## Exchange API Keys

API keys are stored **only in your browser's localStorage** and are never transmitted to any server. Use **read-only API keys** only.

To add real API integration, fork this repo and add your own backend proxy in `js/app.js` → `simulateAPIImport()`.

---

## Project Structure

```
crypto-tax-au/
├── index.html          # Main app (single-page)
├── css/
│   └── style.css       # All styles
├── js/
│   ├── data.js         # Store, CSV parser
│   ├── ato.js          # Tax calculation engine (ATO rules)
│   ├── ui.js           # UI rendering & interactions
│   ├── export.js       # CSV / PDF / JSON exports
│   └── app.js          # App bootstrap & event wiring
└── README.md
```

---

## License

MIT — free to use, modify, and deploy.
