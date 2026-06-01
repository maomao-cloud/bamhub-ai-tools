function parseKibanaValue(value) {
  if (value === undefined) {
    return '';
  }
  const current = String(value).trim();
  if (current.startsWith("'") && current.endsWith("'")) {
    return current.slice(1, -1);
  }
  return current;
}

function getHashSearchParams(url) {
  const hash = url.hash;
  if (!hash || hash === '#') {
    throw new Error('DISCOVER_URL_MISSING_HASH_STATE');
  }

  const queryStart = hash.indexOf('?');
  if (queryStart === -1) {
    throw new Error('DISCOVER_URL_MISSING_HASH_STATE');
  }

  const hashQuery = hash.slice(queryStart + 1);
  if (!hashQuery) {
    throw new Error('DISCOVER_URL_MISSING_HASH_STATE');
  }

  return new URLSearchParams(hashQuery);
}

function findCurrentLevelKeyStart(state, key) {
  const startToken = `${key}:`;
  const trimmedStart = state.search(/\S/);
  const targetDepth = trimmedStart !== -1 && state[trimmedStart] === '(' ? 1 : 0;
  let depth = 0;
  let inQuote = false;

  for (let index = 0; index < state.length; index += 1) {
    const char = state[index];
    const previous = state[index - 1];

    if (char === "'" && previous !== '\\') {
      inQuote = !inQuote;
      continue;
    }

    if (inQuote) {
      continue;
    }

    if (char === '(') {
      depth += 1;
      continue;
    }

    if (char === ')') {
      depth -= 1;
      continue;
    }

    if (depth !== targetDepth || !state.startsWith(startToken, index)) {
      continue;
    }

    const previousNonWhitespace = state.slice(0, index).trimEnd().at(-1);
    if (previousNonWhitespace === undefined || previousNonWhitespace === '(' || previousNonWhitespace === ',') {
      return index;
    }
  }

  return -1;
}

function extractBalancedValue(state, key) {
  const startToken = `${key}:`;
  const keyStart = findCurrentLevelKeyStart(state, key);
  if (keyStart === -1) {
    return undefined;
  }

  let index = keyStart + startToken.length;
  const valueStart = index;
  let depth = 0;
  let inQuote = false;

  for (; index < state.length; index += 1) {
    const char = state[index];
    const previous = state[index - 1];

    if (char === "'" && previous !== '\\') {
      inQuote = !inQuote;
      continue;
    }

    if (inQuote) {
      continue;
    }

    if (char === '(') {
      depth += 1;
      continue;
    }

    if (char === ')') {
      if (depth === 0) {
        break;
      }
      depth -= 1;
      continue;
    }

    if (char === ',' && depth === 0) {
      break;
    }
  }

  return state.slice(valueStart, index);
}

function parseList(value) {
  if (!value || value === '!()') {
    return [];
  }
  if (!value.startsWith('!(') || !value.endsWith(')')) {
    return [];
  }

  return value
    .slice(2, -1)
    .split(',')
    .map((item) => parseKibanaValue(item))
    .filter(Boolean);
}

function parseTimeRange(globalState) {
  const timeState = extractBalancedValue(globalState, 'time');
  if (!timeState) {
    return null;
  }

  const from = parseKibanaValue(extractBalancedValue(timeState, 'from'));
  const to = parseKibanaValue(extractBalancedValue(timeState, 'to'));
  if (!from || !to) {
    return null;
  }

  return { from, to };
}

function parseKql(appState) {
  const queryState = extractBalancedValue(appState, 'query');
  if (!queryState) {
    return '';
  }

  const language = parseKibanaValue(extractBalancedValue(queryState, 'language'));
  if (language && language !== 'kuery') {
    return '';
  }

  return parseKibanaValue(extractBalancedValue(queryState, 'query'));
}

function extractBaseUrl(url) {
  const discoverMarker = '/app/discover';
  const discoverIndex = url.pathname.indexOf(discoverMarker);
  if (discoverIndex <= 0) {
    return url.origin;
  }
  return `${url.origin}${url.pathname.slice(0, discoverIndex)}`;
}

export function parseDiscoverUrl(discoverUrl) {
  const url = new URL(discoverUrl);
  const hashParams = getHashSearchParams(url);
  const appState = hashParams.get('_a');
  if (!appState) {
    throw new Error('DISCOVER_URL_MISSING_APP_STATE');
  }

  const globalState = hashParams.get('_g') ?? '';
  const timeRange = parseTimeRange(globalState);
  const dataViewId = parseKibanaValue(extractBalancedValue(appState, 'index'));
  if (!dataViewId) {
    throw new Error('DISCOVER_URL_MISSING_INDEX');
  }

  return {
    baseUrl: extractBaseUrl(url),
    dataViewId,
    columns: parseList(extractBalancedValue(appState, 'columns')),
    timeRange,
    kql: parseKql(appState)
  };
}
