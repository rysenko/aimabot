const { isTrackingStatusUrl } = require('./validate-url');

// Renewal-portal rows are labelled by applicant name; tracking rows by masked
// process/card number, so they get a different icon.
function formatUrlLabel(url, nome) {
  if (!nome) return url;
  return `${isTrackingStatusUrl(url) ? '🗂️' : '👤'} ${nome}\n${url}`;
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