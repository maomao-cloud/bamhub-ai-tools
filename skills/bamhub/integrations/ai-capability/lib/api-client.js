import { capabilityError } from './errors.js';

function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function safeMessage(status) {
  if (status === 401 || status === 403) return 'AI 能力服务 API Key 无效或已过期。';
  return `AI 能力服务请求失败（HTTP ${status}）。`;
}

export function createApiClient({ baseUrl, apiKey, apiKeyHeader = 'X-API-KEY', timeoutMs = 30000, fetchImpl = fetch }) {
  if (!apiKey) {
    throw capabilityError('AUTH_API_KEY_MISSING', 'AI 能力服务缺少 API Key。', '请配置 API Key 后重试。');
  }

  async function request(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(joinUrl(baseUrl, path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [apiKeyHeader]: apiKey },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        throw capabilityError(
          response.status === 401 || response.status === 403 ? 'AUTH_API_KEY_INVALID' : 'REQUEST_FAILED',
          safeMessage(response.status),
          response.status === 401 || response.status === 403
            ? '请更新 API Key 后重试。'
            : '请检查 AI 能力服务地址和服务状态。'
        );
      }
      if (payload && payload.code !== undefined && payload.code !== 0 && payload.code !== 200) {
        throw capabilityError('REMOTE_ERROR', 'AI 能力服务返回业务错误。', '请检查请求参数和能力状态。');
      }
      return payload?.data ?? payload;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw capabilityError('REQUEST_TIMEOUT', 'AI 能力服务请求超时。', '请缩小请求范围或稍后重试。');
      }
      if (error?.code) throw error;
      throw capabilityError('REQUEST_FAILED', 'AI 能力服务请求失败。', '请检查网络和服务地址后重试。', error);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    list: ({ pageNo = 1, pageSize = 20, keyword, codes } = {}) => request('/ai/capability/page', {
      pageNo, pageSize, ...(keyword ? { keyword } : {}), ...(codes ? { codes } : {}), detail: false
    }),
    describe: code => request('/ai/capability/page', { pageNo: 1, pageSize: 1, codes: [code], detail: true }),
    invoke: (capabilityCode, argumentsValue = {}) => request('/ai/capability/invoke', {
      capabilityCode, arguments: argumentsValue
    })
  };
}
