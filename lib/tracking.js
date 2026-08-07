// The contactenos.aima.gov.pt /tracking/<uuid> page is a JS single-page app: the HTML
// carries no data. It renders from this JSON endpoint, which we call directly.
const TRACKING_API_BASE = 'https://api-contactenos.aima.gov.pt/api/FormTracking/';

const ISO_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

function buildTrackingApiUrl(token) {
  return `${TRACKING_API_BASE}${encodeURIComponent(token)}`;
}

// Timestamps arrive as local Lisbon wall-clock without a zone ("2026-07-18T12:52:23"),
// so reformat the string directly instead of round-tripping through Date.
function formatTrackingDate(value) {
  if (typeof value !== 'string') return null;
  const match = ISO_DATETIME_RE.exec(value.trim());
  if (!match) return value.trim() || null;
  const [, year, month, day, hour, minute] = match;
  return `${day}-${month}-${year} ${hour}:${minute}`;
}

// Returns null when the link is unknown/expired or carries no usable state.
// `historico` is ordered newest-first; the entry flagged `estadoAtual` is the one the
// page highlights, matching the app's own `find(estadoAtual) ?? historico[0]` fallback.
function extractTrackingState(payload) {
  const data = payload && payload.result && payload.result.data;
  if (!data || data.encontrado === false) return null;

  const historico = Array.isArray(data.historico) ? data.historico : [];
  const current = historico.find((entry) => entry && entry.estadoAtual) || historico[0] || null;
  if (!current) return null;

  return {
    estado: (current.labelPt || current.labelEn || '').trim() || null,
    atualizadoEm: formatTrackingDate(current.dataCriacao),
    numero: data.numeroProcessoMascarado || data.numeroTituloMascarado || null,
  };
}

module.exports = { buildTrackingApiUrl, formatTrackingDate, extractTrackingState };
