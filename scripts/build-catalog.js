const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const BASELINE_PATH =
  path.join(ROOT, 'data', 'baseline-scent-index.json');

const VERIFIED_PATH =
  path.join(ROOT, 'data', 'verified-observations.json');

const CATALOG_PATH =
  path.join(ROOT, 'catalog.json');

const VALID_FAMILIES = new Set([
  'bodyCare',
  'candle',
  'wallflower',
  'handSoap',
  'sanitizer',
  'roomSpray',
  'carFragrance'
]);

const KNOWN_BAD_NAMES = new Set([
  '',
  ', then a',
  'all hand soaps',
  'and build from there a',
  'that keeps your skin soft and hydrated are a must add some',
  'to see availability',
  'where you gather for a room filling fragrance place a'
]);

function readJSON(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8')
  );
}

function normalizeKey(value) {
  let text = String(value ?? '')
    .trim()
    .replace(/[®™℠©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  text = text
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  if (
    text === 'sundrenched linen' ||
    text === 'sun drenched linen'
  ) {
    return 'sun drenched linen';
  }

  return text;
}

function isPlausibleName(value) {
  const raw = String(value ?? '').trim();
  const key = normalizeKey(raw);

  if (!raw || KNOWN_BAD_NAMES.has(key)) {
    return false;
  }

  if (/^[,.:;]/.test(raw)) {
    return false;
  }

  const words = raw.split(/\s+/);

  if (
    words.length >= 3 &&
    /^[a-z]/.test(raw)
  ) {
    return false;
  }

  if (words.length > 10 || raw.length > 80) {
    return false;
  }

  return true;
}

function canonicalDisplayName(name) {
  const key = normalizeKey(name);

  if (key === 'sun drenched linen') {
    return 'Sun Drenched Linen';
  }

  return String(name).trim();
}

function observationKey(observation) {
  return [
    observation.family,
    observation.productType,
    observation.sourceURL
  ].join('|');
}

function cleanObservation(observation) {
  if (!observation) {
    return null;
  }

  const family =
    String(observation.family ?? '').trim();

  const productType =
    String(observation.productType ?? '').trim();

  const sourceURL =
    String(observation.sourceURL ?? '').trim();

  if (!VALID_FAMILIES.has(family)) {
    throw new Error(
      `Unknown product family: ${family}`
    );
  }

  if (!productType) {
    throw new Error(
      'Observation is missing productType.'
    );
  }

  if (!sourceURL) {
    throw new Error(
      'Observation is missing sourceURL.'
    );
  }

  if (
    productType ===
    'Bootstrap recommendation-ready scent'
  ) {
    return null;
  }

  return {
    family,
    productType,
    sourceURL
  };
}

function addEntry(indexMap, incomingName, observations) {
  if (!isPlausibleName(incomingName)) {
    console.log(
      `QUARANTINED NAME: "${incomingName}"`
    );
    return;
  }

  const displayName =
    canonicalDisplayName(incomingName);

  const key =
    normalizeKey(displayName);

  if (!key) {
    return;
  }

  let entry =
    indexMap.get(key);

  if (!entry) {
    entry = {
      name: displayName,
      observations: new Map()
    };

    indexMap.set(
      key,
      entry
    );
  }

  for (const rawObservation of observations ?? []) {
    const observation =
      cleanObservation(rawObservation);

    if (!observation) {
      continue;
    }

    entry.observations.set(
      observationKey(observation),
      observation
    );
  }
}

function sortedIndex(indexMap) {
  return Array
    .from(indexMap.values())
    .map(entry => ({
      name: entry.name,
      observations: Array
        .from(entry.observations.values())
        .sort((a, b) => {
          const left =
            `${a.family}|${a.productType}|${a.sourceURL}`;

          const right =
            `${b.family}|${b.productType}|${b.sourceURL}`;

          return left.localeCompare(right);
        })
    }))
    .filter(entry => entry.observations.length > 0)
    .sort((a, b) =>
      a.name.localeCompare(
        b.name,
        undefined,
        { sensitivity: 'base' }
      )
    );
}

function representedFamilies(index) {
  return new Set(
    index.flatMap(entry =>
      entry.observations.map(
        observation => observation.family
      )
    )
  );
}

function main() {
  const baseline =
    readJSON(BASELINE_PATH);

  const verified =
    readJSON(VERIFIED_PATH);

  const existingCatalog =
    readJSON(CATALOG_PATH);

  if (baseline.schemaVersion !== 1) {
    throw new Error(
      `Unsupported baseline schema: ${baseline.schemaVersion}`
    );
  }

  if (verified.schemaVersion !== 1) {
    throw new Error(
      `Unsupported verified-data schema: ${verified.schemaVersion}`
    );
  }

  if (existingCatalog.schemaVersion !== 1) {
    throw new Error(
      `Unsupported catalog schema: ${existingCatalog.schemaVersion}`
    );
  }

  if (!Array.isArray(baseline.scentIndex)) {
    throw new Error(
      'baseline-scent-index.json is missing scentIndex.'
    );
  }

  if (baseline.scentIndex.length !== 99) {
    throw new Error(
      `Expected the cleaned 99-scent baseline, found ${baseline.scentIndex.length}.`
    );
  }

  if (
    !Array.isArray(
      existingCatalog.readyFragrances
    ) ||
    existingCatalog.readyFragrances.length !== 8
  ) {
    throw new Error(
      'Expected exactly 8 recommendation-ready fragrances.'
    );
  }

  const indexMap =
    new Map();

  // Seed with all 99 cleaned identities and their
  // already-known observations.
  for (const entry of baseline.scentIndex) {
    addEntry(
      indexMap,
      entry.name,
      entry.observations
    );
  }

  let verifiedObservationCount = 0;

  for (const batch of verified.batches ?? []) {
    const family =
      String(batch.family ?? '').trim();

    const sourceURL =
      String(batch.sourceURL ?? '').trim();

    if (!VALID_FAMILIES.has(family)) {
      throw new Error(
        `Unknown verified batch family: ${family}`
      );
    }

    if (!sourceURL) {
      throw new Error(
        `Verified batch ${family} is missing sourceURL.`
      );
    }

    for (const product of batch.products ?? []) {
      verifiedObservationCount += 1;

      addEntry(
        indexMap,
        product.name,
        [
          {
            family,
            productType:
              product.productType,
            sourceURL
          }
        ]
      );
    }
  }

  if (verifiedObservationCount !== 107) {
    throw new Error(
      `Expected 107 verified product observations, found ${verifiedObservationCount}.`
    );
  }

  const scentIndex =
    sortedIndex(indexMap);

  const families =
    representedFamilies(scentIndex);

  const readyNames =
    existingCatalog.readyFragrances.map(
      fragrance => fragrance.name
    );

  const scentKeys =
    new Set(
      scentIndex.map(
        entry => normalizeKey(entry.name)
      )
    );

  for (const readyName of readyNames) {
    if (
      !scentKeys.has(
        normalizeKey(readyName)
      )
    ) {
      throw new Error(
        `Recommendation-ready fragrance is missing from the scent index: ${readyName}`
      );
    }
  }

  if (families.size !== 7) {
    throw new Error(
      `Expected 7 represented families, found ${families.size}.`
    );
  }

  if (scentIndex.length !== 125) {
    throw new Error(
      `Expected 125 canonical scent identities, found ${scentIndex.length}.`
    );
  }

  const output = {
    schemaVersion: 1,
    generatedAt:
      new Date().toISOString(),

    readyFragrances:
      existingCatalog.readyFragrances,

    scentIndex
  };

  fs.writeFileSync(
    CATALOG_PATH,
    JSON.stringify(
      output,
      null,
      2
    ) + '\n'
  );

  console.log('');
  console.log('============================================');
  console.log('FRAGRANCEFINDER CATALOG BUILD SUCCEEDED');
  console.log('============================================');
  console.log(`Ready fragrances: ${output.readyFragrances.length}`);
  console.log(`Baseline scents: ${baseline.scentIndex.length}`);
  console.log(`Verified observations: ${verifiedObservationCount}`);
  console.log(`Built scent identities: ${scentIndex.length}`);
  console.log(`Families represented: ${families.size}/7`);
  console.log('');
  console.log('Bootstrap observations removed: yes');
  console.log('Known page-text contamination blocked: yes');
  console.log('============================================');
}

main();
