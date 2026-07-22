export function formatJsonResult({ env, backend, dataViewId, query, logs }) {
  return {
    ok: true,
    env,
    backend,
    dataViewId,
    query,
    logs
  };
}

export function formatTextLogs(logs = []) {
  if (!logs.length) {
    return '';
  }
  return `${logs.join('\n')}\n`;
}

export function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
