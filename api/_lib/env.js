// 키 읽기. 키 값은 절대 응답·로그에 내보내지 않는다.

export function getKey(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

// 공공데이터포털 서비스 키: Encoding 키(%2B·%3D 등이 든 값)와 Decoding 키(원래 값) 둘 다 받는다.
// 항상 Decoding 모양으로 바꿔 두고, 주소에 붙일 때 URLSearchParams 가 한 번만 인코딩하게 한다.
// (Encoding 키를 그대로 URLSearchParams 에 넣으면 % 가 %25 로 두 번 인코딩돼 "등록되지 않은 키" 오류가 난다)
export function normalizeDataGoKrKey(raw) {
  const key = (raw || '').trim();
  if (!key) return '';
  if (/%[0-9A-Fa-f]{2}/.test(key)) {
    try { return decodeURIComponent(key); } catch { return key; }
  }
  return key;
}

export function dataGoKrUrl(base, params, rawKey) {
  const url = new URL(base);
  const sp = new URLSearchParams({ serviceKey: normalizeDataGoKrKey(rawKey), ...params });
  url.search = sp.toString();
  return url.toString();
}

// 시간 제한이 있는 fetch. 시간 초과면 err.code = 'TIMEOUT'
export async function fetchWithTimeout(url, options = {}, ms = 12000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ac.signal });
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('시간 초과');
      err.code = 'TIMEOUT';
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

export function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}
