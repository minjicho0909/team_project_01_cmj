// AI 호출: CLAUDE_API_KEY → GROQ_API_KEY → GEMINI_API_KEY 순서.
// 앞이 실패하면(키 비어 있음 · 오류 · 시간 초과) 다음으로 넘어가고, 누가 답했는지와 실패 사유를 남긴다.
// 모델 이름은 코드에 박지 않고 각 키로 모델 목록을 조회해 고른다. 404 가 나면 모델 이름부터 의심해 목록을 다시 받는다.

import Anthropic from '@anthropic-ai/sdk';
import { getKey, fetchWithTimeout } from './env.js';

const TIMEOUT_MS = 20000;
const modelCache = {}; // { claude: 'id', groq: 'id', gemini: 'models/...' } — 서버 인스턴스가 살아 있는 동안만

class AIError extends Error {
  constructor(reason, detail, status) { super(detail || reason); this.reason = reason; this.status = status; }
}

function reasonOf(e) {
  if (e instanceof AIError) return e.reason;
  if (e?.code === 'TIMEOUT' || e?.name === 'APIConnectionTimeoutError') return '시간 초과';
  if (e?.status === 401 || e?.status === 403) return '키 거부(승인 안 됨)';
  if (e?.status === 404) return '모델 없음(404)';
  if (e?.status === 429) return '사용량 초과(429)';
  if (e?.status) return `오류 ${e.status}`;
  return '오류';
}

// ───────── Claude (공식 SDK) ─────────
async function claudeModel(client, refresh = false) {
  if (modelCache.claude && !refresh) return modelCache.claude;
  const ids = [];
  const page = await client.models.list({ limit: 100 });
  for (const m of page.data) ids.push(m.id);
  // 기본은 Claude Opus 5.5. 목록에 없으면 목록에 있는 Opus → 아무 모델 순서
  const pick = ids.find((id) => id === 'claude-opus-5-5') || ids.find((id) => id.includes('opus')) || ids[0];
  if (!pick) throw new AIError('모델 목록 비어 있음');
  modelCache.claude = pick;
  return pick;
}

async function callClaude({ system, user, schema, maxTokens }) {
  const apiKey = getKey('CLAUDE_API_KEY');
  if (!apiKey) throw new AIError('키 비어 있음');
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });

  const run = async (model) => {
    const params = {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { effort: 'low', ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
    };
    // Opus 5.5 는 안전 분류기가 거절할 때 서버가 다른 모델로 다시 돌려주는 fallbacks 를 켠다
    if (model === 'claude-opus-5-5') {
      return client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    }
    return client.messages.create(params);
  };

  let model = await claudeModel(client);
  let res;
  try {
    res = await run(model);
  } catch (e) {
    if (e?.status !== 404) throw e;
    model = await claudeModel(client, true); // 404 → 모델 이름부터 의심
    res = await run(model);
  }
  if (res.stop_reason === 'refusal') throw new AIError('답변 거절(refusal)');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text) throw new AIError('빈 응답');
  return { text, model: res.model || model };
}

// ───────── Groq (OpenAI 호환 REST) ─────────
async function groqModel(apiKey, refresh = false) {
  if (modelCache.groq && !refresh) return modelCache.groq;
  const r = await fetchWithTimeout('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } }, TIMEOUT_MS);
  if (!r.ok) throw new AIError(r.status === 401 ? '키 거부(승인 안 됨)' : `모델 목록 오류 ${r.status}`, null, r.status);
  const ids = ((await r.json()).data || []).map((m) => m.id);
  const prefer = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
  const pick = prefer.find((p) => ids.includes(p)) || ids.find((id) => !/whisper|guard|tts|prompt|orpheus|compound/i.test(id));
  if (!pick) throw new AIError('모델 목록 비어 있음');
  modelCache.groq = pick;
  return pick;
}

async function callGroq({ system, user, schema, maxTokens }) {
  const apiKey = getKey('GROQ_API_KEY');
  if (!apiKey) throw new AIError('키 비어 있음');
  const run = async (model) => {
    const body = {
      model,
      max_tokens: maxTokens,
      temperature: 0,
      messages: [
        { role: 'system', content: schema ? `${system}\n\n반드시 다음 JSON 스키마에 맞는 JSON 객체 하나만 출력한다:\n${JSON.stringify(schema)}` : system },
        { role: 'user', content: user },
      ],
      ...(schema ? { response_format: { type: 'json_object' } } : {}),
    };
    return fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, TIMEOUT_MS);
  };
  let model = await groqModel(apiKey);
  let r = await run(model);
  if (r.status === 404) { model = await groqModel(apiKey, true); r = await run(model); }
  if (!r.ok) throw new AIError(r.status === 401 ? '키 거부(승인 안 됨)' : r.status === 429 ? '사용량 초과(429)' : `오류 ${r.status}`, null, r.status);
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content || '';
  if (!text) throw new AIError('빈 응답');
  return { text, model };
}

// ───────── Gemini (REST) ─────────
// 후보 모델 목록(좋은 순서). 무료 키는 최신 모델에서 429(사용량)·503(바쁨)이 잦아 다음 후보로 넘어간다.
async function geminiCandidates(apiKey, refresh = false) {
  if (modelCache.geminiList && !refresh) return modelCache.geminiList;
  const r = await fetchWithTimeout('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': apiKey } }, TIMEOUT_MS);
  if (!r.ok) throw new AIError(r.status === 400 || r.status === 401 || r.status === 403 ? '키 거부(승인 안 됨)' : `모델 목록 오류 ${r.status}`, null, r.status);
  const names = ((await r.json()).models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name)
    .filter((n) => /flash/.test(n) && !/image|tts|live|audio|omni|exp|thinking/.test(n));
  const rank = (n) => (/preview/.test(n) ? 2 : 0) + (/latest/.test(n) ? 1 : 0);
  const list = names.sort((a, b) => rank(a) - rank(b) || (a < b ? 1 : -1)).slice(0, 6);
  if (!list.length) throw new AIError('모델 목록 비어 있음');
  modelCache.geminiList = list;
  return list;
}

async function callGemini({ system, user, schema, maxTokens }) {
  const apiKey = getKey('GEMINI_API_KEY');
  if (!apiKey) throw new AIError('키 비어 있음');
  const run = async (model) => fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: schema ? `${system}\n\n반드시 다음 JSON 스키마에 맞는 JSON 객체 하나만 출력한다:\n${JSON.stringify(schema)}` : system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0, maxOutputTokens: maxTokens, ...(schema ? { responseMimeType: 'application/json' } : {}) },
    }),
  }, 9000); // 모델 하나당 9초 — 늦으면 다음 후보 모델로
  // 지난번에 성공한 모델을 먼저, 그다음 후보 순서대로. 404(모델 없음)·429·500·503 이면 다음 후보로.
  const list = await geminiCandidates(apiKey);
  const order = modelCache.gemini ? [modelCache.gemini, ...list.filter((n) => n !== modelCache.gemini)] : list;
  let r;
  let model;
  let lastStatus = 0;
  for (const m of order.slice(0, 4)) {
    model = m;
    try {
      r = await run(m);
    } catch (e) {
      if (e.code !== 'TIMEOUT') throw e;
      r = { ok: false, status: 'TIMEOUT' }; // 이 모델은 시간 초과 → 다음 후보
    }
    if (r.ok) break;
    lastStatus = r.status;
    if (r.status === 400 || r.status === 401 || r.status === 403) break; // 키 문제는 모델을 바꿔도 같다
  }
  if (!r.ok) {
    if (lastStatus === 404) modelCache.geminiList = null; // 다음 요청에서 목록을 다시 받는다
    throw new AIError(lastStatus === 401 || lastStatus === 403 ? '키 거부(승인 안 됨)' : lastStatus === 429 ? '사용량 초과(429)' : lastStatus === 503 ? '서버 바쁨(503)' : lastStatus === 'TIMEOUT' ? '시간 초과' : `오류 ${lastStatus}`, null, lastStatus);
  }
  modelCache.gemini = model;
  const j = await r.json();
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new AIError('빈 응답');
  return { text, model: model.replace(/^models\//, '') };
}

const PROVIDERS = [
  { name: 'Claude', call: callClaude },
  { name: 'Groq', call: callGroq },
  { name: 'Gemini', call: callGemini },
];

/**
 * @returns {{ text, provider, model, tried: {provider, reason}[] }}
 * 셋 다 실패하면 provider 가 null 이고 tried 에 이유가 남는다.
 */
export async function callAI({ system, user, schema = null, maxTokens = 1500, skip = [] }) {
  const tried = [];
  for (const p of PROVIDERS) {
    if (skip.includes(p.name)) { tried.push({ provider: p.name, reason: '건너뜀(시험용)' }); continue; }
    try {
      const out = await p.call({ system, user, schema, maxTokens });
      return { ...out, provider: p.name, tried };
    } catch (e) {
      tried.push({ provider: p.name, reason: reasonOf(e) });
    }
  }
  return { text: '', provider: null, model: null, tried };
}

export function parseJsonLoose(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}
