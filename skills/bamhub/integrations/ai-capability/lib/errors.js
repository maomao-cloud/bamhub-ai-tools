export class AiCapabilityError extends Error {
  constructor(code, message, suggestion, cause) {
    super(message, { cause });
    this.name = 'AiCapabilityError';
    this.code = code;
    this.suggestion = suggestion;
  }
}

export function capabilityError(code, message, suggestion, cause) {
  return new AiCapabilityError(code, message, suggestion, cause);
}

export function errorPayload(error) {
  return {
    ok: false,
    error: {
      code: error?.code || 'AI_CAPABILITY_FAILED',
      message: error?.message || 'AI 能力调用失败。',
      suggestion: error?.suggestion || '请检查配置、鉴权信息和服务状态后重试。'
    }
  };
}
