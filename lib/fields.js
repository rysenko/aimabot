const { isTrackingStatusUrl } = require('./validate-url');

// Both URL kinds share the monitored_urls value columns; only the labels differ.
// `scrapeAs` names the field for the scraper's extractor lookup.
const PORTAL_FIELDS = [
  { key: 'ultima_atualizacao', label: '📅 Última Atualização', scrapeAs: 'Última Atualização' },
  { key: 'situacao_at_ss',     label: '📋 Situação AT/SS',     scrapeAs: 'Situação AT/SS' },
  { key: 'estado',             label: '🏛️ Estado',            scrapeAs: 'Estado' },
];

const TRACKING_FIELDS = [
  { key: 'estado',             label: '📍 Estado' },
  { key: 'ultima_atualizacao', label: '📅 Atualizado em' },
];

function fieldsForUrl(url) {
  return isTrackingStatusUrl(url) ? TRACKING_FIELDS : PORTAL_FIELDS;
}

module.exports = { PORTAL_FIELDS, TRACKING_FIELDS, fieldsForUrl };
