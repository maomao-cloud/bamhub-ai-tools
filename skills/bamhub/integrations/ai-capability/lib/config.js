import fs from 'node:fs';
import { capabilityError } from './errors.js';

const DEFAULT_CONFIG = 'skills/bamhub/integrations/ai-capability/.local/config.json';

export function loadConfig(file = process.env.AI_CAPABILITY_CONFIG || DEFAULT_CONFIG) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw capabilityError(
      'CONFIG_INVALID',
      'AI 能力服务配置缺失或格式无效。',
      `请配置 AI_CAPABILITY_CONFIG，或创建 ${DEFAULT_CONFIG}。`,
      error
    );
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.services || typeof parsed.services !== 'object') {
    throw capabilityError('CONFIG_INVALID', 'AI 能力服务配置缺少 services。', '请参考 templates/config.example.json。');
  }
  return parsed;
}

export function resolveService(config, name = process.env.AI_CAPABILITY_SERVICE || config.defaultService) {
  const service = name && config.services[name];
  if (!service || typeof service !== 'object' || !service.baseUrl) {
    throw capabilityError(
      'SERVICE_INVALID',
      `AI 能力服务 ${name || '(missing)'} 未配置。`,
      '请检查 defaultService、AI_CAPABILITY_SERVICE 和服务配置。'
    );
  }
  return { ...service, name };
}

export function resolveApiKey(service, env = process.env) {
  const envName = service.apiKeyEnv || 'AI_CAPABILITY_API_KEY';
  const apiKey = env[envName];
  if (!apiKey || !String(apiKey).trim()) {
    throw capabilityError(
      'AUTH_API_KEY_MISSING',
      'AI 能力服务缺少 API Key。',
      `请配置环境变量 ${envName} 后重试。`
    );
  }
  return String(apiKey).trim();
}
