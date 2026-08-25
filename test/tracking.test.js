const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildTrackingApiUrl, formatTrackingDate, extractTrackingState, isCardDelivered } = require('../lib/tracking');

const TOKEN = '00000000-0000-0000-0000-000000000000';

function payload(data) {
  return { result: { type: 'EstadoProcesso', submittedAt: '2026-02-23T14:06:50', data }, success: true, error: null };
}

describe('buildTrackingApiUrl', () => {
  it('builds the FormTracking endpoint for a token', () => {
    assert.equal(
      buildTrackingApiUrl(TOKEN),
      `https://api-contactenos.aima.gov.pt/api/FormTracking/${TOKEN}`
    );
  });

  it('encodes the token', () => {
    assert.equal(
      buildTrackingApiUrl('a/../b'),
      'https://api-contactenos.aima.gov.pt/api/FormTracking/a%2F..%2Fb'
    );
  });
});

describe('formatTrackingDate', () => {
  it('reformats a zone-less ISO timestamp to dd-mm-yyyy hh:mm', () => {
    assert.equal(formatTrackingDate('2026-07-18T12:52:23'), '18-07-2026 12:52');
  });

  it('keeps the wall-clock time regardless of the host timezone', () => {
    // A Date round-trip would shift this by the local UTC offset.
    assert.equal(formatTrackingDate('2026-01-01T00:30:00'), '01-01-2026 00:30');
  });

  it('handles fractional seconds', () => {
    assert.equal(formatTrackingDate('2026-08-07T10:23:01.6076837'), '07-08-2026 10:23');
  });

  it('returns unrecognised strings unchanged', () => {
    assert.equal(formatTrackingDate('brevemente'), 'brevemente');
  });

  it('returns null for non-strings and blanks', () => {
    assert.equal(formatTrackingDate(null), null);
    assert.equal(formatTrackingDate(undefined), null);
    assert.equal(formatTrackingDate('   '), null);
  });
});

describe('extractTrackingState', () => {
  it('picks the entry flagged estadoAtual, not the newest one', () => {
    const state = extractTrackingState(payload({
      encontrado: true,
      numeroProcessoMascarado: '*****2453',
      historico: [
        { labelPt: 'Cartão em produção', dataCriacao: '2026-08-01T09:30:00', estadoAtual: false },
        { labelPt: 'Decisão final – Deferido', dataCriacao: '2026-07-18T12:52:23', estadoAtual: true },
      ],
    }));

    assert.deepEqual(state, {
      estado: 'Decisão final – Deferido',
      atualizadoEm: '18-07-2026 12:52',
      numero: '*****2453',
    });
  });

  it('falls back to the first history entry when nothing is flagged', () => {
    const state = extractTrackingState(payload({
      encontrado: true,
      historico: [
        { labelPt: 'Em análise', dataCriacao: '2026-02-27T18:54:38' },
        { labelPt: 'Submetido', dataCriacao: '2026-02-23T14:06:50' },
      ],
    }));

    assert.equal(state.estado, 'Em análise');
    assert.equal(state.atualizadoEm, '27-02-2026 18:54');
  });

  it('uses the masked card number for card tracking links', () => {
    const state = extractTrackingState(payload({
      encontrado: true,
      numeroProcessoMascarado: null,
      numeroTituloMascarado: '*****7788',
      historico: [{ labelPt: 'Cartão enviado', dataCriacao: '2026-08-01T09:30:00', estadoAtual: true }],
    }));

    assert.equal(state.numero, '*****7788');
    assert.equal(state.estado, 'Cartão enviado');
  });

  it('falls back to the English label when the Portuguese one is missing', () => {
    const state = extractTrackingState(payload({
      encontrado: true,
      historico: [{ labelEn: 'Card delivered', dataCriacao: '2026-08-01T09:30:00', estadoAtual: true }],
    }));

    assert.equal(state.estado, 'Card delivered');
  });

  it('returns null when the process is not found', () => {
    assert.equal(extractTrackingState(payload({ encontrado: false })), null);
  });

  it('returns null when the history is empty or missing', () => {
    assert.equal(extractTrackingState(payload({ encontrado: true, historico: [] })), null);
    assert.equal(extractTrackingState(payload({ encontrado: true })), null);
  });

  it('returns null for an error envelope or malformed payload', () => {
    assert.equal(extractTrackingState({ result: null, success: false, error: { message: 'NotFound' } }), null);
    assert.equal(extractTrackingState(null), null);
    assert.equal(extractTrackingState('<html>not json</html>'), null);
  });
});

describe('isCardDelivered', () => {
  it('recognises the Portuguese and English terminal labels', () => {
    assert.equal(isCardDelivered('Cartão entregue'), true);
    assert.equal(isCardDelivered('Card delivered'), true);
  });

  it('ignores case, padding and missing diacritics', () => {
    assert.equal(isCardDelivered('  CARTAO  ENTREGUE '), true);
    assert.equal(isCardDelivered('card Delivered'), true);
  });

  it('returns false for every earlier tracking state', () => {
    for (const estado of ['Cartão enviado', 'Cartão emitido', 'Cartão em produção', 'Decisão final – Deferido']) {
      assert.equal(isCardDelivered(estado), false, estado);
    }
  });

  it('returns false for portal estados and non-strings', () => {
    assert.equal(isCardDelivered('Pedido Deferido (6)'), false);
    assert.equal(isCardDelivered(null), false);
    assert.equal(isCardDelivered(undefined), false);
    assert.equal(isCardDelivered(''), false);
  });
});
