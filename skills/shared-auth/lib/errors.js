export function authError(code, message, suggestion) {
  return { ok: false, error: { code, message, suggestion } };
}

export function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
