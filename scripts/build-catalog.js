const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const BASELINE_PATH =
  path.join(
    ROOT,
    'data',
    'baseline-scent-index.json'
  );

const VERIFIED_PATH =
  path.join(
    ROOT,
    'data',
    'verified-observations.json'
  );

const NOTE_EVIDENCE_PATH =
  path.join(
    ROOT,
    'data',
    'note-evidence.json'
  );

const ENRICHMENT_DIR =
  path.join(
    ROOT,
    'data',
    'enrichment'
  );

const CATALOG_PATH =
  path.join(
    ROOT,
    'catalog.json'
  );

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
    fs.readFileSync(
      file,
      'utf8'
    )
  );
}

function normalizeKey(value) {
  let text =
    String(value ?? '')
      .trim()
      .replace(/[®™℠©]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[’']/g, '')
      .normalize('NFD')
      .replace(
        /[\u0300-\u036f]/g,
        ''
      )
      .toLowerCase();

  text =
    text
      .replace(
        /[^a-z0-9]+/g,
        ' '
      )
      .trim()
      .replace(
        /\s+/g,
        ' '
      );

  if (
    text === 'sundrenched linen' ||
    text === 'sun drenched linen'
  ) {
    return 'sun drenched linen';
  }

  return text;
}

function isPlausibleName(value) {
  const raw =
    String(value ?? '').trim();

  const key =
    normalizeKey(raw);

  if (
    !raw ||
    KNOWN_BAD_NAMES.has(key)
  ) {
    return false;
  }

  if (/^[,.:;]/.test(raw)) {
    return false;
  }

  const words =
    raw.split(/\s+/);

  if (
    words.length >= 3 &&
    /^[a-z]/.test(raw)
  ) {
    return false;
  }

  if (
    words.length > 10 ||
    raw.length > 80
  ) {
    return false;
  }

  return true;
}

function canonicalDisplayName(name) {
  const key =
    normalizeKey(name);

  if (
    key ===
    'sun drenched linen'
  ) {
    return 'Sun Drenched Linen';
  }

  return String(name).trim();
}

function observationKey(
  observation
) {
  return [
    observation.family,
    observation.productType,
    observation.sourceURL
  ].join('|');
}

function cleanObservation(
  observation
) {
  if (!observation) {
    return null;
  }

  const family =
    String(
      observation.family ?? ''
    ).trim();

  const productType =
    String(
      observation.productType ?? ''
    ).trim();

  const sourceURL =
    String(
      observation.sourceURL ?? ''
    ).trim();

  if (
    !VALID_FAMILIES.has(
      family
    )
  ) {
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

function addEntry(
  indexMap,
  incomingName,
  observations
) {
  if (
    !isPlausibleName(
      incomingName
    )
  ) {
    console.log(
      `QUARANTINED NAME: "${incomingName}"`
    );

    return;
  }

  const displayName =
    canonicalDisplayName(
      incomingName
    );

  const key =
    normalizeKey(
      displayName
    );

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

  for (
    const rawObservation
    of observations ?? []
  ) {
    const observation =
      cleanObservation(
        rawObservation
      );

    if (!observation) {
      continue;
    }

    entry.observations.set(
      observationKey(
        observation
      ),
      observation
    );
  }
}

function sortedIndex(
  indexMap
) {
  return Array
    .from(
      indexMap.values()
    )
    .map(
      entry => ({
        name: entry.name,

        observations:
          Array
            .from(
              entry
                .observations
                .values()
            )
            .sort(
              (a, b) => {
                const left =
                  `${a.family}|${a.productType}|${a.sourceURL}`;

                const right =
                  `${b.family}|${b.productType}|${b.sourceURL}`;

                return left.localeCompare(
                  right
                );
              }
            )
      })
    )
    .filter(
      entry =>
        entry
          .observations
          .length > 0
    )
    .sort(
      (a, b) =>
        a.name.localeCompare(
          b.name,
          undefined,
          {
            sensitivity: 'base'
          }
        )
    );
}

function representedFamilies(
  index
) {
  return new Set(
    index.flatMap(
      entry =>
        entry.observations.map(
          observation =>
            observation.family
        )
    )
  );
}

function validateFragranceRecord(
  fragrance,
  sourceFile
) {
  if (
    !fragrance ||
    typeof fragrance !==
      'object'
  ) {
    throw new Error(
      `Invalid fragrance record in ${sourceFile}.`
    );
  }

  const name =
    String(
      fragrance.name ?? ''
    ).trim();

  if (!name) {
    throw new Error(
      `Fragrance in ${sourceFile} is missing name.`
    );
  }

  if (
    !Array.isArray(
      fragrance.officialNotes
    ) ||
    fragrance
      .officialNotes
      .length === 0
  ) {
    throw new Error(
      `${name} in ${sourceFile} has no officialNotes.`
    );
  }

  if (
    !Array.isArray(
      fragrance.feedbackOptions
    ) ||
    fragrance
      .feedbackOptions
      .length === 0
  ) {
    throw new Error(
      `${name} in ${sourceFile} has no feedbackOptions.`
    );
  }

  if (
    !fragrance.scentProfile ||
    typeof fragrance.scentProfile !==
      'object'
  ) {
    throw new Error(
      `${name} in ${sourceFile} has no scentProfile.`
    );
  }

  if (
    !Array.isArray(
      fragrance.styleTags
    )
  ) {
    throw new Error(
      `${name} in ${sourceFile} has invalid styleTags.`
    );
  }

  if (
    !String(
      fragrance.summary ?? ''
    ).trim()
  ) {
    throw new Error(
      `${name} in ${sourceFile} has no summary.`
    );
  }

  if (
    !String(
      fragrance.availability ?? ''
    ).trim()
  ) {
    throw new Error(
      `${name} in ${sourceFile} has no availability.`
    );
  }
}

function loadReadyFragrances() {
  if (
    !fs.existsSync(
      ENRICHMENT_DIR
    )
  ) {
    throw new Error(
      'Missing data/enrichment directory.'
    );
  }

  const files =
    fs
      .readdirSync(
        ENRICHMENT_DIR
      )
      .filter(
        file =>
          file.endsWith(
            '.json'
          )
      )
      .sort();

  if (
    files.length === 0
  ) {
    throw new Error(
      'No enrichment JSON files were found.'
    );
  }

  const readyMap =
    new Map();

  for (
    const file
    of files
  ) {
    const fullPath =
      path.join(
        ENRICHMENT_DIR,
        file
      );

    const payload =
      readJSON(
        fullPath
      );

    if (
      payload.schemaVersion !==
      1
    ) {
      throw new Error(
        `Unsupported enrichment schema in ${file}.`
      );
    }

    if (
      !Array.isArray(
        payload.fragrances
      )
    ) {
      throw new Error(
        `${file} is missing fragrances[].`
      );
    }

    for (
      const fragrance
      of payload.fragrances
    ) {
      validateFragranceRecord(
        fragrance,
        file
      );

      const key =
        normalizeKey(
          fragrance.name
        );

      if (
        readyMap.has(key)
      ) {
        throw new Error(
          `Duplicate recommendation-ready fragrance: ${fragrance.name}`
        );
      }

      readyMap.set(
        key,
        fragrance
      );
    }
  }

  return Array
    .from(
      readyMap.values()
    )
    .sort(
      (a, b) =>
        a.name.localeCompare(
          b.name,
          undefined,
          {
            sensitivity: 'base'
          }
        )
    );
}

function cleanEvidenceNotes(
  notes,
  context
) {
  if (
    !Array.isArray(notes) ||
    notes.length === 0
  ) {
    throw new Error(
      `${context} has no notes.`
    );
  }

  const cleaned =
    notes.map(
      note =>
        String(
          note ?? ''
        ).trim()
    );

  if (
    cleaned.some(
      note => !note
    )
  ) {
    throw new Error(
      `${context} contains an empty note.`
    );
  }

  return cleaned;
}

function noteSignature(
  notes
) {
  return notes
    .map(
      note =>
        normalizeKey(note)
    )
    .join('|');
}

function loadNoteEvidence(
  readyFragrances
) {
  if (
    !fs.existsSync(
      NOTE_EVIDENCE_PATH
    )
  ) {
    throw new Error(
      'Missing data/note-evidence.json.'
    );
  }

  const payload =
    readJSON(
      NOTE_EVIDENCE_PATH
    );

  if (
    payload.schemaVersion !==
    1
  ) {
    throw new Error(
      `Unsupported note-evidence schema: ${payload.schemaVersion}`
    );
  }

  if (
    !Array.isArray(
      payload.records
    )
  ) {
    throw new Error(
      'note-evidence.json is missing records[].'
    );
  }

  const readyKeys =
    new Set(
      readyFragrances.map(
        fragrance =>
          normalizeKey(
            fragrance.name
          )
      )
    );

  const evidenceMap =
    new Map();

  for (
    const record
    of payload.records
  ) {
    if (
      !record ||
      typeof record !==
        'object'
    ) {
      throw new Error(
        'Invalid note-evidence record.'
      );
    }

    const name =
      String(
        record.name ?? ''
      ).trim();

    const key =
      normalizeKey(name);

    if (!name || !key) {
      throw new Error(
        'Note-evidence record is missing name.'
      );
    }

    if (
      !readyKeys.has(key)
    ) {
      throw new Error(
        `Note evidence references a fragrance that is not recommendation-ready: ${name}`
      );
    }

    if (
      evidenceMap.has(key)
    ) {
      throw new Error(
        `Duplicate note-evidence record: ${name}`
      );
    }

    const displaySourceId =
      String(
        record
          .displaySourceId ??
          ''
      ).trim();

    if (
      !displaySourceId
    ) {
      throw new Error(
        `${name} is missing displaySourceId.`
      );
    }

    if (
      !Array.isArray(
        record.evidence
      ) ||
      record
        .evidence
        .length === 0
    ) {
      throw new Error(
        `${name} has no note evidence.`
      );
    }

    const ids =
      new Set();

    const evidence =
      record.evidence.map(
        raw => {
          const id =
            String(
              raw.id ?? ''
            ).trim();

          const family =
            String(
              raw.family ?? ''
            ).trim();

          const productType =
            String(
              raw.productType ??
              ''
            ).trim();

          const sourceURL =
            String(
              raw.sourceURL ??
              ''
            ).trim();

          const verifiedAt =
            String(
              raw.verifiedAt ??
              ''
            ).trim();

          if (!id) {
            throw new Error(
              `${name} has evidence with no id.`
            );
          }

          if (
            ids.has(id)
          ) {
            throw new Error(
              `${name} has duplicate evidence id: ${id}`
            );
          }

          ids.add(id);

          if (
            !VALID_FAMILIES.has(
              family
            )
          ) {
            throw new Error(
              `${name} evidence ${id} has unknown family: ${family}`
            );
          }

          if (
            !productType
          ) {
            throw new Error(
              `${name} evidence ${id} is missing productType.`
            );
          }

          if (
            !sourceURL.startsWith(
              'https://www.bathandbodyworks.com/'
            )
          ) {
            throw new Error(
              `${name} evidence ${id} is not an official Bath & Body Works URL.`
            );
          }

          if (
            !verifiedAt ||
            Number.isNaN(
              Date.parse(
                `${verifiedAt}T00:00:00Z`
              )
            )
          ) {
            throw new Error(
              `${name} evidence ${id} has invalid verifiedAt.`
            );
          }

          const notes =
            cleanEvidenceNotes(
              raw.notes,
              `${name} evidence ${id}`
            );

          return {
            id,
            family,
            productType,
            sourceURL,
            verifiedAt,
            notes
          };
        }
      );

    if (
      !ids.has(
        displaySourceId
      )
    ) {
      throw new Error(
        `${name} displaySourceId does not match any evidence id: ${displaySourceId}`
      );
    }

    const displayEvidence =
      evidence.find(
        item =>
          item.id ===
          displaySourceId
      );

    const signatures =
      new Set(
        evidence.map(
          item =>
            noteSignature(
              item.notes
            )
        )
      );

    let status =
      'singleSource';

    if (
      evidence.length > 1
    ) {
      status =
        signatures.size === 1
          ? 'consistentAcrossSources'
          : 'formatVariant';
    }

    evidenceMap.set(
      key,
      {
        name,
        displaySourceId,
        displayNotes:
          displayEvidence.notes,
        status,
        evidence
      }
    );
  }

  return evidenceMap;
}

function attachNoteEvidence(
  readyFragrances,
  noteEvidenceMap
) {
  return readyFragrances.map(
    fragrance => {
      const key =
        normalizeKey(
          fragrance.name
        );

      const provenance =
        noteEvidenceMap.get(key);

      if (!provenance) {
        return fragrance;
      }

      return {
        ...fragrance,

        noteEvidenceStatus:
          provenance.status,

        noteDisplaySourceId:
          provenance
            .displaySourceId,

        verifiedDisplayNotes:
          provenance
            .displayNotes,

        noteEvidence:
          provenance
            .evidence
      };
    }
  );
}

function buildNoteEvidenceSummary(
  sourceReadyFragrances,
  noteEvidenceMap
) {
  let evidenceObservations = 0;
  let formatVariantRecords = 0;
  let readyNoteMismatches = 0;

  const sourceMap =
    new Map(
      sourceReadyFragrances.map(
        fragrance => [
          normalizeKey(
            fragrance.name
          ),
          fragrance
        ]
      )
    );

  for (
    const [
      key,
      provenance
    ]
    of noteEvidenceMap
  ) {
    evidenceObservations +=
      provenance
        .evidence
        .length;

    if (
      provenance.status ===
      'formatVariant'
    ) {
      formatVariantRecords += 1;
    }

    const fragrance =
      sourceMap.get(key);

    if (
      fragrance &&
      noteSignature(
        fragrance.officialNotes
      ) !==
        noteSignature(
          provenance
            .displayNotes
        )
    ) {
      readyNoteMismatches += 1;
    }
  }

  return {
    records:
      noteEvidenceMap.size,

    evidenceObservations,

    formatVariantRecords,

    readyNoteMismatches
  };
}

function main() {
  const baseline =
    readJSON(
      BASELINE_PATH
    );

  const verified =
    readJSON(
      VERIFIED_PATH
    );

  if (
    baseline.schemaVersion !==
    1
  ) {
    throw new Error(
      `Unsupported baseline schema: ${baseline.schemaVersion}`
    );
  }

  if (
    verified.schemaVersion !==
    1
  ) {
    throw new Error(
      `Unsupported verified-data schema: ${verified.schemaVersion}`
    );
  }

  if (
    !Array.isArray(
      baseline.scentIndex
    )
  ) {
    throw new Error(
      'baseline-scent-index.json is missing scentIndex.'
    );
  }

  if (
    typeof baseline.scentCount ===
      'number' &&
    baseline.scentCount !==
      baseline.scentIndex.length
  ) {
    throw new Error(
      'Baseline scentCount does not match scentIndex length.'
    );
  }

  if (
    baseline
      .scentIndex
      .length < 99
  ) {
    throw new Error(
      `Baseline unexpectedly shrank to ${baseline.scentIndex.length} scents.`
    );
  }

  const sourceReadyFragrances =
    loadReadyFragrances();

  if (
    sourceReadyFragrances.length <
    8
  ) {
    throw new Error(
      `Recommendation-ready catalog unexpectedly shrank to ${sourceReadyFragrances.length}.`
    );
  }

  const noteEvidenceMap =
    loadNoteEvidence(
      sourceReadyFragrances
    );

  const readyFragrances =
    attachNoteEvidence(
      sourceReadyFragrances,
      noteEvidenceMap
    );

  const noteEvidenceSummary =
    buildNoteEvidenceSummary(
      sourceReadyFragrances,
      noteEvidenceMap
    );

  const indexMap =
    new Map();

  for (
    const entry
    of baseline.scentIndex
  ) {
    addEntry(
      indexMap,
      entry.name,
      entry.observations
    );
  }

  let verifiedObservationCount =
    0;

  for (
    const batch
    of verified.batches ?? []
  ) {
    const family =
      String(
        batch.family ?? ''
      ).trim();

    const sourceURL =
      String(
        batch.sourceURL ?? ''
      ).trim();

    if (
      !VALID_FAMILIES.has(
        family
      )
    ) {
      throw new Error(
        `Unknown verified batch family: ${family}`
      );
    }

    if (!sourceURL) {
      throw new Error(
        `Verified batch ${family} is missing sourceURL.`
      );
    }

    for (
      const product
      of batch.products ?? []
    ) {
      verifiedObservationCount +=
        1;

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

  const scentIndex =
    sortedIndex(
      indexMap
    );

  const families =
    representedFamilies(
      scentIndex
    );

  const scentKeys =
    new Set(
      scentIndex.map(
        entry =>
          normalizeKey(
            entry.name
          )
      )
    );

  for (
    const fragrance
    of readyFragrances
  ) {
    if (
      !scentKeys.has(
        normalizeKey(
          fragrance.name
        )
      )
    ) {
      throw new Error(
        `Recommendation-ready fragrance is missing from the scent index: ${fragrance.name}`
      );
    }
  }

  if (
    families.size !== 7
  ) {
    throw new Error(
      `Expected 7 represented families, found ${families.size}.`
    );
  }

  if (
    scentIndex.length < 125
  ) {
    throw new Error(
      `Discovery catalog unexpectedly shrank to ${scentIndex.length} scents.`
    );
  }

  const output = {
    schemaVersion: 1,

    generatedAt:
      new Date().toISOString(),

    noteEvidenceSummary,

    readyFragrances,

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
  console.log(
    '============================================'
  );
  console.log(
    'FRAGRANCEFINDER CATALOG BUILD SUCCEEDED'
  );
  console.log(
    '============================================'
  );

  console.log(
    `Ready fragrances: ${readyFragrances.length}`
  );

  console.log(
    `Baseline scents: ${baseline.scentIndex.length}`
  );

  console.log(
    `Verified observations: ${verifiedObservationCount}`
  );

  console.log(
    `Built scent identities: ${scentIndex.length}`
  );

  console.log(
    `Families represented: ${families.size}/7`
  );

  console.log('');

  console.log(
    `Note evidence records: ${noteEvidenceSummary.records}`
  );

  console.log(
    `Note evidence observations: ${noteEvidenceSummary.evidenceObservations}`
  );

  console.log(
    `Format-variant records: ${noteEvidenceSummary.formatVariantRecords}`
  );

  console.log(
    `Ready-note mismatches: ${noteEvidenceSummary.readyNoteMismatches}`
  );

  console.log('');

  console.log(
    'Ready-fragrance source: data/enrichment/*.json'
  );

  console.log(
    'Note-evidence source: data/note-evidence.json'
  );

  console.log(
    'Bootstrap observations removed: yes'
  );

  console.log(
    'Known page-text contamination blocked: yes'
  );

  console.log(
    'Existing officialNotes changed by provenance layer: no'
  );

  console.log(
    '============================================'
  );
}

main();
