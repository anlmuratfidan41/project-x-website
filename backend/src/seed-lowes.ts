import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { database } from './database.js';

const checkedAt = '2026-10-01';
const store = 'Washington, DC #3256 (ZIP 20006)';
const products = [
  {
    name: '1/2 in. x 4 ft. x 8 ft. Gold Bond drywall panel', category: 'Drywall', unit: 'sheet', unitPrice: 16.98,
    supplierUrl: 'https://www.lowes.com/pd/Gold-Bond-1-2-in-x-4-ft-x-8-ft-High-Strength-LITE-Drywall-Panel/5001486207',
    imageUrl: '/assets/products/drywall-panel.jpg', stockQty: 12,
  },
  {
    name: '1/2 in. x 4 ft. x 8 ft. mold-resistant drywall panel', category: 'Drywall', unit: 'sheet', unitPrice: 23.58,
    supplierUrl: 'https://www.lowes.com/pd/CertainTeed-Common-1-2-in-x-4-ft-x-8-ft-Actual-0-5-in-x-4-ft-x-8-ft-Drywall-Panel/1002992836',
    imageUrl: '/assets/products/mold-resistant-drywall.jpg', stockQty: 8,
  },
  {
    name: '2 in. x 4 in. x 8 ft. pressure-treated lumber', category: 'Lumber', unit: 'each', unitPrice: 4.98,
    supplierUrl: 'https://www.lowes.com/pd/Severe-Weather-Common-2-in-x-4-in-x-8-ft-Actual-1-5-in-x-3-5-in-x-8-ft-2-Prime-Treated-Lumber/4564608',
    imageUrl: '/assets/products/treated-lumber.jpg', stockQty: 20,
  },
  {
    name: '15A GFCI decorator electrical outlet', category: 'Electrical', unit: 'each', unitPrice: 18.98,
    supplierUrl: 'https://www.lowes.com/pd/Eaton-15-Amp-125-Volt-GFCI-Residential-Decorator-Outlet-White/5014437343',
    imageUrl: '/assets/products/gfci-outlet.jpg', stockQty: 8,
  },
  {
    name: '15A weather-resistant GFCI electrical outlet', category: 'Electrical', unit: 'each', unitPrice: 20.48,
    supplierUrl: 'https://www.lowes.com/pd/Eaton-15-Amp-125-Volt-Tamper-Resistant-Weather-Resistant-AFCI-GFCI-Residential-Decorator-Outlet-White/5014437323',
    imageUrl: '/assets/products/weather-resistant-gfci.jpg', stockQty: 6,
  },
  {
    name: 'Delta Arvo bathroom sink faucet, brushed nickel', category: 'Bathroom', unit: 'each', unitPrice: 129.10,
    supplierUrl: 'https://www.lowes.com/pd/Delta-Arvo-SpotShield-Stainless-Single-hole-1-handle-WaterSense-Mid-arc-Residential-Handle-Pull-down-Bathroom-Sink-Faucet-with-Drain-with-Deck-Plate/5016086943',
    imageUrl: '/assets/products/bathroom-faucet.jpeg', stockQty: 5,
  },
  {
    name: '12 in. x 24 in. Statuario porcelain floor tile', category: 'Tile', unit: 'sq ft', unitPrice: 1.99,
    supplierUrl: 'https://www.lowes.com/pd/Satori-Statuario-Polished-Porcelain-Common-Actual-23-62-in-x-11-81-in/1002802304',
    imageUrl: '/assets/products/porcelain-tile.jpg', stockQty: 60,
  },
  {
    name: '10 x 3 in. Deck Plus exterior deck screws, 310 count', category: 'Balcony & deck', unit: 'box', unitPrice: 29.98,
    supplierUrl: 'https://www.lowes.com/pd/Deck-Plus-10-x-3-in-Ceramic-Deck-Screws-5-lb/1000318525',
    imageUrl: '/assets/products/deck-screws.jpeg', stockQty: 5,
  },
  {
    name: 'Airecoler commercial dehumidifier, 125 pints', category: 'Equipment rental', unit: 'each', unitPrice: 389.99,
    supplierUrl: 'https://www.lowes.com/pd/Airecoler-125-Pints-Commercial-Dehumidifier-for-Crawl-Space-and-Basement-Up-to-6000-Sq-Ft-with-Drain-Hose-Auto-Defrost-Memory-Restart-5-Years-Warranty/9297008',
    imageUrl: '/assets/products/commercial-dehumidifier.jpeg', stockQty: 5,
  },
  {
    name: 'HGTV Home 5 gallon interior primer', category: 'Paint & primer', unit: 'bucket', unitPrice: 99,
    supplierUrl: 'https://www.lowes.com/pd/HGTV-HOME-by-Sherwin-Williams-HGSW-All-Purpose-Power-Primer-5G/5014537507',
    imageUrl: '/assets/products/interior-primer.jpeg', stockQty: 5,
  },
];

const findByUrl = database.prepare('SELECT id FROM materials WHERE supplier_url = ?');
const findByName = database.prepare('SELECT id FROM materials WHERE supplier = ? AND name = ? ORDER BY stock_qty DESC LIMIT 1');
const update = database.prepare(`
  UPDATE materials SET name = ?, category = ?, unit = ?, unit_price = ?, supplier = ?, supplier_url = ?,
    stock_qty = CASE WHEN stock_qty < ? THEN ? ELSE stock_qty END,
    price_source = 'manual', supplier_store = ?, image_url = ?, price_checked_at = ?, updated_at = datetime('now')
  WHERE id = ?
`);
const insert = database.prepare(`
  INSERT INTO materials (id, name, category, unit, unit_price, supplier, stock_qty, price_source,
    supplier_url, supplier_store, image_url, price_checked_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)
`);
const removeDuplicates = database.prepare('DELETE FROM materials WHERE supplier = ? AND name = ? AND id != ?');

let added = 0;
let refreshed = 0;
const seed = database.transaction(() => {
  for (const product of products) {
    const existing = (findByUrl.get(product.supplierUrl)
      ?? findByName.get("Lowe's", product.name)) as { id: string } | undefined;
    if (existing) {
      update.run(product.name, product.category, product.unit, product.unitPrice, "Lowe's", product.supplierUrl,
        product.stockQty, product.stockQty, store, product.imageUrl, checkedAt, existing.id);
      removeDuplicates.run("Lowe's", product.name, existing.id);
      refreshed += 1;
    } else {
      insert.run(randomUUID(), product.name, product.category, product.unit, product.unitPrice, "Lowe's", product.stockQty, product.supplierUrl, store, product.imageUrl, checkedAt);
      added += 1;
    }
  }
});

seed();
console.info(`Lowe's catalog: ${added} added, ${refreshed} refreshed for ${store}.`);
database.close();
