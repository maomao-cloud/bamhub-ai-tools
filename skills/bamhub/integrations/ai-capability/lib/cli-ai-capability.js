import { createApiClient } from './api-client.js';
import { loadConfig, resolveApiKey, resolveService } from './config.js';
import { errorPayload } from './errors.js';

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : undefined;
}

function print(payload, json) {
  process.stdout.write(json ? `${JSON.stringify(payload, null, 2)}\n` : `${JSON.stringify(payload)}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const json = args.includes('--json');
  const config = loadConfig();
  const service = resolveService(config, option(args, '--service'));
  const client = createApiClient({
    baseUrl: service.baseUrl,
    apiKey: resolveApiKey(service),
    apiKeyHeader: service.apiKeyHeader,
    timeoutMs: service.timeoutMs
  });

  if (command === 'capabilities') {
    return client.list({ keyword: option(args, '--keyword') });
  }
  if (command === 'describe') {
    const code = option(args, '--code');
    if (!code) throw Object.assign(new Error('能力编码不能为空。'), {
      code: 'CAPABILITY_CODE_REQUIRED', suggestion: '使用 --code <capability-code>。'
    });
    return client.describe(code);
  }
  if (command === 'invoke') {
    const code = option(args, '--code');
    const rawArguments = option(args, '--arguments') || '{}';
    if (!code) throw Object.assign(new Error('能力编码不能为空。'), {
      code: 'CAPABILITY_CODE_REQUIRED', suggestion: '使用 --code <capability-code>。'
    });
    let argumentsValue;
    try {
      argumentsValue = JSON.parse(rawArguments);
    } catch {
      throw Object.assign(new Error('调用参数必须是合法 JSON。'), {
        code: 'ARGUMENTS_INVALID', suggestion: '使用 --arguments \'{"field":"value"}\'。'
      });
    }
    return client.invoke(code, argumentsValue);
  }
  throw Object.assign(new Error('AI 能力命令缺失或不支持。'), {
    code: 'COMMAND_UNSUPPORTED', suggestion: '使用 capabilities、describe 或 invoke。'
  });
}

main().then(result => print({ ok: true, data: result }, process.argv.includes('--json')))
  .catch(error => {
    print(errorPayload(error), process.argv.includes('--json'));
    process.exitCode = 1;
  });
