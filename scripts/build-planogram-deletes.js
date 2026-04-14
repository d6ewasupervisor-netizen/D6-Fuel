/**
 * Extract "Products Removed From Planogram (DELETE)" UPCs from Kroger planogram PDFs.
 * Run: node scripts/build-planogram-deletes.js
 */
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

const PUBLIC = path.join(__dirname, '..', 'public');

const PDF_MAP = [
  {
    file: 'D701_L00000_D58_C142_V664_D002_MX - HABCO- RED BULL COOLER 12 FT ASSORTMENT.pdf',
    planogramKey: 'HABCO Red Bull Cooler 12 FT'
  },
  {
    file: 'D701_L00000_D58_C142_V707_D002_MX - HABCO- RED BULL COOLER 8 FT ASSORTMENT.pdf',
    planogramKey: 'HABCO Red Bull Cooler 8 FT'
  },
  {
    file: 'D701_L00000_D58_C142_V670_D002_MX - HABCO MONSTER COOLER 12 FT ASSORTMENT.pdf',
    planogramKey: 'HABCO Monster Cooler 12 FT'
  },
  {
    file: 'D701_L00000_D58_C142_V671_D002_MX - HABCO MONSTER COOLER 8 FT ASSORTMENT.pdf',
    planogramKey: 'HABCO Monster Cooler 8 FT'
  },
  {
    file: 'D701_L00000_D58_C142_V898_D001_MX - GDM 9- CSD.pdf',
    planogramKey: 'GDM 9 - CSD'
  },
  {
    file: 'D701_L00000_D58_C142_V899_D001_MX - GDM 9- ALL BEVERAGE.pdf',
    planogramKey: 'GDM 9 - All Beverage'
  }
];

function normalizeUpcKey(str) {
  let d = String(str || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 8 && d[0] === '0') {
    const expanded = expandUpcEto12(d);
    if (expanded) d = expanded;
  }
  if (d.length === 13 && d[0] === '0') d = d.slice(1);
  while (d.length < 12) d = '0' + d;
  if (d.length > 12) d = d.slice(-12);
  return d;
}

function upcCheckDigit11(eleven) {
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const n = parseInt(eleven[i], 10);
    if (Number.isNaN(n)) return null;
    sum += (i % 2 === 0) ? n * 3 : n;
  }
  return (10 - (sum % 10)) % 10;
}

function expandUpcEto12(upc8) {
  const d = String(upc8 || '').replace(/\D/g, '');
  if (d.length !== 8 || d[0] !== '0') return null;
  const ns = d[0];
  const d1 = d[1], d2 = d[2], d3 = d[3], d4 = d[4], d5 = d[5], d6 = d[6];
  let eleven;
  if (d6 <= '2') {
    eleven = ns + d1 + d2 + d6 + '0000' + d3 + d4 + d5;
  } else if (d6 === '3') {
    eleven = ns + d1 + d2 + d3 + '00000' + d4 + d5;
  } else if (d6 === '4') {
    eleven = ns + d1 + d2 + d3 + d4 + '00000' + d5;
  } else {
    eleven = ns + d1 + d2 + d3 + d4 + d5 + '0000' + d6;
  }
  if (eleven.length !== 11) return null;
  const chk = upcCheckDigit11(eleven);
  if (chk === null) return null;
  return eleven + String(chk);
}

function parseDeleteLine(line) {
  const idx = line.search(/[A-Za-z]/);
  if (idx < 12) return null;
  const numPart = line.slice(0, idx).trim();
  if (!/^\d+$/.test(numPart)) return null;
  for (let rl = 1; rl <= 3; rl++) {
    const restLen = numPart.length - rl;
    if (restLen < 12 || restLen > 14) continue;
    const row = numPart.slice(0, rl);
    const upcRaw = numPart.slice(rl);
    if (!/^\d{12,14}$/.test(upcRaw)) continue;
    const upc = normalizeUpcKey(upcRaw);
    if (!upc) continue;
    const tail = line.slice(idx).trim();
    const sizeMatch = tail.match(/(\d+(?:\.\d+)?\s*(?:FO|OZ|PK|CT|LT|ML|G|LB)[A-Za-z\s]*)$/i);
    const size = sizeMatch ? sizeMatch[1].replace(/\s+/g, ' ').trim() : '';
    const description = size ? tail.slice(0, tail.length - sizeMatch[0].length).trim() : tail;
    return { row, upc, description, size };
  }
  return null;
}

function extractDeleteSection(fullText) {
  const start = fullText.indexOf('Products Removed From Planogram (DELETE)');
  if (start < 0) return null;
  const after = fullText.slice(start);
  const ends = [
    after.indexOf('\nProducts Added To Planogram (NEW)'),
    after.indexOf('Products Added To Planogram (NEW)'),
    after.indexOf('Products Changed on Planogram'),
    after.indexOf('UPC Change FromUPC Change To'),
    after.indexOf('\nPage:')
  ].filter(i => i > 0);
  const end = ends.length ? Math.min(...ends) : after.length;
  const section = after.slice(0, end);
  const marker = 'UPCProductSize';
  const pos = section.indexOf(marker);
  const body = pos >= 0 ? section.slice(pos + marker.length) : section;
  return body;
}

async function parsePdfDeletes(filePath) {
  const buf = fs.readFileSync(filePath);
  const data = await pdf(buf);
  const body = extractDeleteSection(data.text);
  if (body === null) {
    console.warn('No "Products Removed" marker in PDF:', filePath);
    return [];
  }
  const items = [];
  const lines = body.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('DBKey:') || line.startsWith('Property of')) continue;
    const parsed = parseDeleteLine(line);
    if (parsed) items.push(parsed);
  }
  return items;
}

async function main() {
  const byUpc = {};
  const byPlanogram = {};
  const all = [];

  for (const { file, planogramKey } of PDF_MAP) {
    const fp = path.join(PUBLIC, file);
    if (!fs.existsSync(fp)) {
      console.warn('Missing PDF:', fp);
      continue;
    }
    const items = await parsePdfDeletes(fp);
    byPlanogram[planogramKey] = [];
    for (const it of items) {
      const entry = {
        upc: it.upc,
        fromPlanogram: planogramKey,
        description: it.description,
        size: it.size
      };
      all.push(entry);
      byPlanogram[planogramKey].push(entry);
      if (!byUpc[it.upc]) byUpc[it.upc] = [];
      byUpc[it.upc].push({
        fromPlanogram: planogramKey,
        description: it.description,
        size: it.size
      });
    }
    console.log(planogramKey + ': ' + items.length + ' delete line(s)');
  }

  const out = {
    generated: new Date().toISOString(),
    source: 'Parsed from planogram PDF "Products Removed From Planogram (DELETE)" sections',
    byUpc,
    byPlanogram
  };

  const outPath = path.join(PUBLIC, 'planogram-deletes.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log('Wrote', outPath, '—', all.length, 'total delete entries');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
