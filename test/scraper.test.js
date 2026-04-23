const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const { formatUrlLabel, extractFieldValue, isPedidoDeferido } = require('../lib/scraper');

describe('formatUrlLabel', () => {
  const url = 'https://aima.gov.pt/test';

  it('returns URL only when nome is null', () => {
    assert.equal(formatUrlLabel(url, null), url);
  });

  it('returns URL only when nome is undefined', () => {
    assert.equal(formatUrlLabel(url, undefined), url);
  });

  it('returns URL only when nome is empty string', () => {
    assert.equal(formatUrlLabel(url, ''), url);
  });

  it('returns nome + URL when nome is provided', () => {
    assert.equal(formatUrlLabel(url, 'João Silva'), `👤 João Silva\n${url}`);
  });
});

describe('extractFieldValue', () => {
  describe('input fields', () => {
    it('extracts Situação AT/SS from input value attr', () => {
      const $ = cheerio.load('<input id="P72_VALIDADO" value="Validado">');
      assert.equal(extractFieldValue($, 'Situação AT/SS'), 'Validado');
    });

    it('extracts Estado from input value attr', () => {
      const $ = cheerio.load('<input id="P72_ESTADO_1" value="Ativo">');
      assert.equal(extractFieldValue($, 'Estado'), 'Ativo');
    });

    it('extracts Estado with data-return-value', () => {
      const $ = cheerio.load('<input id="P72_ESTADO_1" data-return-value="4" value="Pedido Aguarda Avaliação">');
      assert.equal(extractFieldValue($, 'Estado'), 'Pedido Aguarda Avaliação (4)');
    });

    it('ignores empty data-return-value for Estado', () => {
      const $ = cheerio.load('<input id="P72_ESTADO_1" data-return-value="" value="Ativo">');
      assert.equal(extractFieldValue($, 'Estado'), 'Ativo');
    });

    it('returns null when input element is missing', () => {
      const $ = cheerio.load('<div>no input here</div>');
      assert.equal(extractFieldValue($, 'Situação AT/SS'), null);
    });

    it('returns null when input value is empty', () => {
      const $ = cheerio.load('<input id="P72_VALIDADO" value="">');
      assert.equal(extractFieldValue($, 'Situação AT/SS'), null);
    });

    it('trims whitespace from input values', () => {
      const $ = cheerio.load('<input id="P72_VALIDADO" value="  Validado  ">');
      assert.equal(extractFieldValue($, 'Situação AT/SS'), 'Validado');
    });
  });

  describe('span fields', () => {
    it('extracts Última Atualização from span text', () => {
      const $ = cheerio.load('<span id="P72_LAST_UPDATED_AT_DISPLAY">2024-02-20</span>');
      assert.equal(extractFieldValue($, 'Última Atualização'), '2024-02-20');
    });

    it('returns null when span element is missing', () => {
      const $ = cheerio.load('<div>no span here</div>');
      assert.equal(extractFieldValue($, 'Última Atualização'), null);
    });

    it('returns null when span text is empty', () => {
      const $ = cheerio.load('<span id="P72_LAST_UPDATED_AT_DISPLAY">  </span>');
      assert.equal(extractFieldValue($, 'Última Atualização'), null);
    });
  });

  describe('edge cases', () => {
    it('returns null for unknown field name', () => {
      const $ = cheerio.load('<div>anything</div>');
      assert.equal(extractFieldValue($, 'Unknown Field'), null);
    });

    it('does not throw on empty HTML', () => {
      const $ = cheerio.load('');
      assert.equal(extractFieldValue($, 'Estado'), null);
    });

    it('does not throw on complex HTML without target elements', () => {
      const $ = cheerio.load('<html><body><div class="content"><p>Hello</p></div></body></html>');
      assert.equal(extractFieldValue($, 'Última Atualização'), null);
    });
  });
});

describe('isPedidoDeferido', () => {
  it('returns true for status ending with (6)', () => {
    assert.equal(isPedidoDeferido('Pedido Deferido (6)'), true);
  });

  it('returns true with trailing whitespace', () => {
    assert.equal(isPedidoDeferido('Pedido Deferido (6)   '), true);
  });

  it('returns false for other codes', () => {
    assert.equal(isPedidoDeferido('Pedido Aguarda Avaliação (4)'), false);
    assert.equal(isPedidoDeferido('Outro (16)'), false);
  });

  it('returns false for plain status without code', () => {
    assert.equal(isPedidoDeferido('Pedido Deferido'), false);
  });

  it('returns false for null/undefined/non-string', () => {
    assert.equal(isPedidoDeferido(null), false);
    assert.equal(isPedidoDeferido(undefined), false);
    assert.equal(isPedidoDeferido(6), false);
  });
});
