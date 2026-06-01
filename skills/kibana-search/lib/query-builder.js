const FIELD_BY_FILTER = {
  service: 'serviceField',
  level: 'levelField',
  keyword: 'messageField',
  traceId: 'traceIdField'
};

function isPresent(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function requireField(fields, fieldKey) {
  const fieldName = fields?.[fieldKey];
  if (!isPresent(fieldName)) {
    throw new Error(`KQL_FIELD_MISSING:${fieldKey}`);
  }
  return fieldName.trim();
}

export function escapeKqlValue(value) {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"');
}

export function buildKql(fields, filters = {}) {
  const clauses = [];

  for (const [filterKey, fieldKey] of Object.entries(FIELD_BY_FILTER)) {
    const value = filters[filterKey];
    if (!isPresent(value)) {
      continue;
    }

    const fieldName = requireField(fields, fieldKey);
    clauses.push(`${fieldName}:"${escapeKqlValue(value.trim())}"`);
  }

  return clauses.join(' and ');
}
