const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const TAXONOMY_PATH =
  path.join(
    ROOT,
    'data',
    'trait-taxonomy.json'
  );

const ENRICHMENT_DIR =
  path.join(
    ROOT,
    'data',
    'enrichment'
  );

function readJSON(filePath) {
  return JSON.parse(
    fs.readFileSync(
      filePath,
      'utf8'
    )
  );
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function loadTaxonomy() {
  if (
    !fs.existsSync(
      TAXONOMY_PATH
    )
  ) {
    throw new Error(
      'Missing data/trait-taxonomy.json.'
    );
  }

  const taxonomy =
    readJSON(
      TAXONOMY_PATH
    );

  if (
    taxonomy.schemaVersion !== 1
  ) {
    throw new Error(
      `Unsupported trait-taxonomy schema: ${taxonomy.schemaVersion}`
    );
  }

  if (
    taxonomy.vocabularyVersion !== 2
  ) {
    throw new Error(
      `Expected vocabularyVersion 2, found ${taxonomy.vocabularyVersion}.`
    );
  }

  if (
    !Array.isArray(
      taxonomy.traits
    ) ||
    taxonomy.traits.length === 0
  ) {
    throw new Error(
      'trait-taxonomy.json is missing traits[].'
    );
  }

  const traitMap =
    new Map();

  for (
    const trait
    of taxonomy.traits
  ) {
    const key =
      normalizeText(
        trait.key
      );

    const category =
      normalizeText(
        trait.category
      );

    const description =
      normalizeText(
        trait.description
      );

    if (!key) {
      throw new Error(
        'Trait taxonomy contains an empty key.'
      );
    }

    if (
      traitMap.has(key)
    ) {
      throw new Error(
        `Duplicate trait-taxonomy key: ${key}`
      );
    }

    if (!category) {
      throw new Error(
        `Trait ${key} is missing category.`
      );
    }

    if (!description) {
      throw new Error(
        `Trait ${key} is missing description.`
      );
    }

    traitMap.set(
      key,
      trait
    );
  }

  return {
    taxonomy,
    traitMap
  };
}

function loadEnrichmentFiles() {
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
      'No enrichment JSON files found.'
    );
  }

  return files;
}

function validate() {
  const {
    taxonomy,
    traitMap
  } =
    loadTaxonomy();

  const files =
    loadEnrichmentFiles();

  const usedTraits =
    new Set();

  const fragranceNames =
    new Set();

  let fragranceCount = 0;
  let feedbackOptionCount = 0;
  let profileAssignmentCount = 0;

  const repeatedFeedbackMappings =
    [];

  for (
    const file
    of files
  ) {
    const filePath =
      path.join(
        ENRICHMENT_DIR,
        file
      );

    const payload =
      readJSON(
        filePath
      );

    if (
      payload.schemaVersion !== 1
    ) {
      throw new Error(
        `${file} has unsupported schemaVersion ${payload.schemaVersion}.`
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
      fragranceCount += 1;

      const name =
        normalizeText(
          fragrance.name
        );

      if (!name) {
        throw new Error(
          `${file} contains a fragrance with no name.`
        );
      }

      const normalizedName =
        name.toLowerCase();

      if (
        fragranceNames.has(
          normalizedName
        )
      ) {
        throw new Error(
          `Duplicate recommendation-ready fragrance across enrichment files: ${name}`
        );
      }

      fragranceNames.add(
        normalizedName
      );

      if (
        !fragrance.scentProfile ||
        typeof fragrance.scentProfile !==
          'object' ||
        Array.isArray(
          fragrance.scentProfile
        )
      ) {
        throw new Error(
          `${name} has an invalid scentProfile.`
        );
      }

      for (
        const [
          profileKey,
          rawWeight
        ]
        of Object.entries(
          fragrance.scentProfile
        )
      ) {
        profileAssignmentCount += 1;

        if (
          !traitMap.has(
            profileKey
          )
        ) {
          throw new Error(
            `${name} uses unknown scentProfile trait: ${profileKey}`
          );
        }

        if (
          !Number.isInteger(
            rawWeight
          ) ||
          rawWeight < 1 ||
          rawWeight > 3
        ) {
          throw new Error(
            `${name} has invalid weight for ${profileKey}: ${rawWeight}. Expected integer 1...3.`
          );
        }

        usedTraits.add(
          profileKey
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
          `${name} has no feedbackOptions.`
        );
      }

      const feedbackKeyCounts =
        new Map();

      for (
        const option
        of fragrance.feedbackOptions
      ) {
        feedbackOptionCount += 1;

        const label =
          normalizeText(
            option.label
          );

        const profileKey =
          normalizeText(
            option.profileKey
          );

        if (!label) {
          throw new Error(
            `${name} has a feedback option with no label.`
          );
        }

        if (!profileKey) {
          throw new Error(
            `${name} feedback option "${label}" has no profileKey.`
          );
        }

        if (
          !traitMap.has(
            profileKey
          )
        ) {
          throw new Error(
            `${name} feedback option "${label}" maps to unknown trait: ${profileKey}`
          );
        }

        usedTraits.add(
          profileKey
        );

        feedbackKeyCounts.set(
          profileKey,
          (
            feedbackKeyCounts.get(
              profileKey
            ) ?? 0
          ) + 1
        );
      }

      const repeated =
        Array
          .from(
            feedbackKeyCounts.entries()
          )
          .filter(
            ([, count]) =>
              count > 1
          );

      if (
        repeated.length > 0
      ) {
        repeatedFeedbackMappings.push({
          name,
          keys:
            repeated.map(
              ([key, count]) =>
                `${key}×${count}`
            )
        });
      }
    }
  }

  const unusedTraits =
    taxonomy.traits
      .map(
        trait =>
          trait.key
      )
      .filter(
        key =>
          !usedTraits.has(key)
      );

  console.log('');
  console.log(
    '============================================'
  );
  console.log(
    'TRAIT TAXONOMY VALIDATION PASSED'
  );
  console.log(
    '============================================'
  );

  console.log(
    `Vocabulary version: ${taxonomy.vocabularyVersion}`
  );

  console.log(
    `Taxonomy traits: ${taxonomy.traits.length}`
  );

  console.log(
    `Enrichment files: ${files.length}`
  );

  console.log(
    `Recommendation-ready fragrances: ${fragranceCount}`
  );

  console.log(
    `Profile assignments: ${profileAssignmentCount}`
  );

  console.log(
    `Feedback options: ${feedbackOptionCount}`
  );

  console.log(
    'Unknown scentProfile keys: 0'
  );

  console.log(
    'Unknown feedback profileKeys: 0'
  );

  console.log(
    'Invalid profile weights: 0'
  );

  console.log('');

  console.log(
    `Repeated feedback-mapping fragrances: ${repeatedFeedbackMappings.length}`
  );

  for (
    const item
    of repeatedFeedbackMappings
  ) {
    console.log(
      `  ${item.name}: ${item.keys.join(', ')}`
    );
  }

  console.log('');

  console.log(
    `Unused taxonomy traits: ${unusedTraits.length}`
  );

  if (
    unusedTraits.length > 0
  ) {
    console.log(
      `  ${unusedTraits.join(', ')}`
    );
  }

  console.log(
    '============================================'
  );

  return {
    vocabularyVersion:
      taxonomy.vocabularyVersion,

    taxonomyTraitCount:
      taxonomy.traits.length,

    enrichmentFileCount:
      files.length,

    fragranceCount,

    profileAssignmentCount,

    feedbackOptionCount,

    repeatedFeedbackMappings,

    unusedTraits
  };
}

validate();
