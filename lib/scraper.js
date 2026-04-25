function formatUrlLabel(url, nome) {
  return nome ? `👤 ${nome}\n${url}` : url;
}

function readInput($, id) {
  const el = $(`input#${id}`);
  if (!el.length) return null;
  const trimmed = (el.val() || el.attr('value') || '').trim();
  return trimmed || null;
}

function readSpan($, id) {
  const el = $(`span#${id}`);
  if (!el.length) return null;
  return el.text().trim() || null;
}

function readEstado($, id) {
  const el = $(`input#${id}`);
  if (!el.length) return null;
  const trimmed = (el.val() || el.attr('value') || '').trim();
  if (!trimmed) return null;
  const ret = el.attr('data-return-value');
  return ret ? `${trimmed} (${ret})` : trimmed;
}

const FIELD_EXTRACTORS = {
  'Situação AT/SS': ($) => readInput($, 'P72_VALIDADO'),
  'Última Atualização': ($) => readSpan($, 'P72_LAST_UPDATED_AT_DISPLAY'),
  'Estado': ($) => readEstado($, 'P72_ESTADO_1'),
};

function extractFieldValue($, fieldName) {
  const extractor = FIELD_EXTRACTORS[fieldName];
  return extractor ? extractor($) : null;
}

function isPedidoDeferido(estado) {
  return typeof estado === 'string' && /\(6\)\s*$/.test(estado.trim());
}

module.exports = { formatUrlLabel, extractFieldValue, isPedidoDeferido };