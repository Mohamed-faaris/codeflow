const PROVIDER_ENV = {
  openai: {
    apiKey: 'OPENAI_API_KEY',
    baseUrl: 'OPENAI_BASE_URL',
    model: 'OPENAI_MODEL',
    embeddingModel: 'OPENAI_EMBEDDING_MODEL'
  },
  anthropic: {
    apiKey: 'ANTHROPIC_API_KEY',
    baseUrl: 'ANTHROPIC_BASE_URL',
    model: 'ANTHROPIC_MODEL'
  },
  gemini: {
    apiKey: 'GEMINI_API_KEY',
    baseUrl: 'GEMINI_BASE_URL',
    model: 'GEMINI_MODEL',
    embeddingModel: 'GEMINI_EMBEDDING_MODEL'
  },
  ollama: {
    baseUrl: 'OLLAMA_BASE_URL',
    model: 'OLLAMA_MODEL',
    embeddingModel: 'OLLAMA_EMBEDDING_MODEL'
  },
  'openai-compatible': {
    apiKey: 'OPENAI_COMPATIBLE_API_KEY',
    baseUrl: 'OPENAI_COMPATIBLE_BASE_URL',
    model: 'OPENAI_COMPATIBLE_MODEL',
    embeddingModel: 'OPENAI_COMPATIBLE_EMBEDDING_MODEL'
  }
};

const DEFAULTS = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', embeddingModel: 'text-embedding-3-small' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', embeddingModel: 'gemini-embedding-001' },
  ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5-coder:7b', embeddingModel: 'nomic-embed-text' },
  'openai-compatible': { baseUrl: '', model: '', embeddingModel: '' }
};

function joinUrl(base, suffix) {
  return String(base).replace(/\/+$/, '') + '/' + String(suffix).replace(/^\/+/, '');
}

function cleanMessage(message) {
  return {
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: String(message.content ?? '')
  };
}

async function requestJson(url, init, label) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(Number(process.env.AI_REQUEST_TIMEOUT_MS || 90000))
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text.slice(0, 1000) }; }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || response.statusText;
    throw new Error(label + ' request failed (' + response.status + '): ' + String(message).slice(0, 500));
  }
  return payload;
}

export function providerConfig(name, overrides = {}) {
  if (!Object.hasOwn(PROVIDER_ENV, name)) throw new Error('Unsupported provider: ' + name);
  const env = PROVIDER_ENV[name];
  const defaults = DEFAULTS[name];
  const result = {
    name,
    apiKey: overrides.apiKey || (env.apiKey ? process.env[env.apiKey] : undefined),
    baseUrl: overrides.baseUrl || (env.baseUrl ? process.env[env.baseUrl] : undefined) || defaults.baseUrl,
    model: overrides.model || (env.model ? process.env[env.model] : undefined) || defaults.model,
    embeddingModel: overrides.embeddingModel || (env.embeddingModel ? process.env[env.embeddingModel] : undefined) || defaults.embeddingModel
  };
  if (name === 'openai-compatible' && !result.baseUrl) {
    result.baseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL;
  }
  return result;
}

export function listProviderStatus() {
  return Object.keys(PROVIDER_ENV).map((name) => {
    const config = providerConfig(name);
    const hasKey = ['ollama', 'openai-compatible'].includes(name) ? Boolean(config.baseUrl) : Boolean(config.apiKey);
    const supportsEmbeddings = name !== 'anthropic' && Boolean(config.embeddingModel);
    return {
      id: name,
      configured: hasKey && Boolean(config.model),
      model: config.model,
      embeddingModel: supportsEmbeddings ? config.embeddingModel : null,
      capabilities: { chat: true, streaming: false, embeddings: supportsEmbeddings }
    };
  });
}

function requireProviderConfig(name, overrides) {
  const config = providerConfig(name, overrides);
  if (!config.model) throw new Error('No model configured for provider ' + name);
  if (!['ollama', 'openai-compatible'].includes(name) && !config.apiKey) throw new Error('Missing API key for provider ' + name);
  if (name === 'openai-compatible' && !config.baseUrl) throw new Error('OPENAI_COMPATIBLE_BASE_URL is required');
  return config;
}

async function openAiGenerate(config, messages, options) {
  const payload = await requestJson(joinUrl(config.baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: { ...(config.apiKey ? { authorization: 'Bearer ' + config.apiKey } : {}), 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 3000,
      response_format: options.json ? { type: 'json_object' } : undefined
    })
  }, config.name);
  return {
    content: payload.choices?.[0]?.message?.content || '',
    usage: payload.usage || {},
    model: payload.model || config.model,
    provider: config.name
  };
}

async function anthropicGenerate(config, messages, options) {
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
  const conversation = messages.filter((message) => message.role !== 'system').map(cleanMessage);
  const payload = await requestJson(joinUrl(config.baseUrl, 'messages'), {
    method: 'POST',
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model,
      system,
      messages: conversation,
      max_tokens: options.maxTokens ?? 3000,
      temperature: options.temperature ?? 0.2
    })
  }, config.name);
  return {
    content: (payload.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n'),
    usage: payload.usage || {},
    model: payload.model || config.model,
    provider: config.name
  };
}

async function geminiGenerate(config, messages, options) {
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
  const contents = messages.filter((message) => message.role !== 'system').map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(message.content) }]
  }));
  const payload = await requestJson(
    joinUrl(config.baseUrl, 'models/' + encodeURIComponent(config.model) + ':generateContent?key=' + encodeURIComponent(config.apiKey)),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents,
        generationConfig: {
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxTokens ?? 3000,
          responseMimeType: options.json ? 'application/json' : undefined
        }
      })
    },
    config.name
  );
  return {
    content: (payload.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join(''),
    usage: payload.usageMetadata || {},
    model: config.model,
    provider: config.name
  };
}

async function ollamaGenerate(config, messages, options) {
  const payload = await requestJson(joinUrl(config.baseUrl, 'api/chat'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      format: options.json ? 'json' : undefined,
      options: { temperature: options.temperature ?? 0.2, num_predict: options.maxTokens ?? 3000 }
    })
  }, config.name);
  return {
    content: payload.message?.content || '',
    usage: { prompt_tokens: payload.prompt_eval_count, completion_tokens: payload.eval_count },
    model: payload.model || config.model,
    provider: config.name
  };
}

async function openAiEmbeddings(config, texts) {
  const payload = await requestJson(joinUrl(config.baseUrl, 'embeddings'), {
    method: 'POST',
    headers: { ...(config.apiKey ? { authorization: 'Bearer ' + config.apiKey } : {}), 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.embeddingModel, input: texts })
  }, config.name);
  return (payload.data || []).sort((a, b) => a.index - b.index).map((item) => item.embedding);
}

async function geminiEmbeddings(config, texts) {
  const payload = await requestJson(
    joinUrl(config.baseUrl, 'models/' + encodeURIComponent(config.embeddingModel) + ':batchEmbedContents?key=' + encodeURIComponent(config.apiKey)),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: 'models/' + config.embeddingModel,
          content: { parts: [{ text }] },
          taskType: 'RETRIEVAL_DOCUMENT'
        }))
      })
    },
    config.name
  );
  return (payload.embeddings || []).map((item) => item.values || []);
}

async function ollamaEmbeddings(config, texts) {
  const payload = await requestJson(joinUrl(config.baseUrl, 'api/embed'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.embeddingModel, input: texts })
  }, config.name);
  return payload.embeddings || [];
}

export function createProviderManager() {
  return {
    list: listProviderStatus,
    async generate(options) {
      const name = options.provider || process.env.DEFAULT_LLM_PROVIDER || 'openai';
      const config = requireProviderConfig(name, options);
      const messages = (options.messages || []).map((message) => ({
        role: message.role,
        content: String(message.content ?? '')
      }));
      if (!messages.length) throw new Error('At least one message is required');
      if (name === 'anthropic') return anthropicGenerate(config, messages, options);
      if (name === 'gemini') return geminiGenerate(config, messages, options);
      if (name === 'ollama') return ollamaGenerate(config, messages, options);
      return openAiGenerate(config, messages, options);
    },
    async embed(options) {
      const name = options.provider || process.env.EMBEDDING_PROVIDER || 'openai';
      const config = requireProviderConfig(name, options);
      if (name === 'anthropic') throw new Error('Anthropic does not expose a native embeddings API; configure another embedding provider');
      if (!config.embeddingModel) throw new Error('No embedding model configured for provider ' + name);
      const texts = (options.texts || []).map((text) => String(text));
      if (!texts.length) return { provider: name, model: config.embeddingModel, embeddings: [] };
      let embeddings;
      if (name === 'gemini') embeddings = await geminiEmbeddings(config, texts);
      else if (name === 'ollama') embeddings = await ollamaEmbeddings(config, texts);
      else embeddings = await openAiEmbeddings(config, texts);
      if (embeddings.length !== texts.length || embeddings.some((vector) => !Array.isArray(vector) || !vector.length)) {
        throw new Error('Embedding provider returned an invalid vector batch');
      }
      const dimensions = embeddings[0].length;
      if (embeddings.some((vector) => vector.length !== dimensions)) throw new Error('Embedding dimensions differ within the batch');
      return { provider: name, model: config.embeddingModel, embeddings };
    }
  };
}

export function parseJsonResponse(content) {
  const raw = String(content || '').trim();
  const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try { return JSON.parse(cleaned); } catch {
    throw new Error('The model did not return valid JSON');
  }
}
