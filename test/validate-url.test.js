const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isValidAimaUrl } = require('../lib/validate-url');

describe('isValidAimaUrl', () => {
  describe('valid URLs', () => {
    it('accepts portal-renovacoes.aima.gov.pt (real subdomain)', () => {
      const parsed = isValidAimaUrl(
        'https://portal-renovacoes.aima.gov.pt/ords/r/aima/aima-pr/validar?p71_lang=pt&p72_link=VALIDATE&p72_token=abc123'
      );
      assert.equal(parsed.hostname, 'portal-renovacoes.aima.gov.pt');
    });

    it('accepts bare aima.gov.pt', () => {
      const parsed = isValidAimaUrl('https://aima.gov.pt/some/path');
      assert.equal(parsed.hostname, 'aima.gov.pt');
    });

    it('accepts any subdomain of aima.gov.pt', () => {
      const parsed = isValidAimaUrl('https://www.aima.gov.pt/page');
      assert.equal(parsed.hostname, 'www.aima.gov.pt');
    });

    it('accepts deeply nested subdomains', () => {
      const parsed = isValidAimaUrl('https://a.b.aima.gov.pt/page');
      assert.equal(parsed.hostname, 'a.b.aima.gov.pt');
    });

    it('accepts http scheme', () => {
      const parsed = isValidAimaUrl('http://aima.gov.pt/page');
      assert.equal(parsed.hostname, 'aima.gov.pt');
    });
  });

  describe('SSRF prevention — invalid domains', () => {
    it('rejects aima.gov.pt in query string', () => {
      assert.throws(() => isValidAimaUrl('https://evil.com/?aima.gov.pt'), Error);
    });

    it('rejects aima.gov.pt in path', () => {
      assert.throws(() => isValidAimaUrl('https://evil.com/aima.gov.pt'), Error);
    });

    it('rejects aima.gov.pt as subdomain of another domain', () => {
      assert.throws(() => isValidAimaUrl('https://aima.gov.pt.evil.com/page'), Error);
    });

    it('rejects aima.gov.pt in basic auth position', () => {
      assert.throws(() => isValidAimaUrl('https://aima.gov.pt@evil.com/page'), Error);
    });

    it('rejects look-alike domains', () => {
      assert.throws(() => isValidAimaUrl('https://notaima.gov.pt/page'), Error);
    });

    it('rejects totally unrelated domains', () => {
      assert.throws(() => isValidAimaUrl('https://google.com'), Error);
    });

    it('rejects aima.gov.pt in fragment', () => {
      assert.throws(() => isValidAimaUrl('https://evil.com/#aima.gov.pt'), Error);
    });
  });

  describe('malformed URLs', () => {
    it('throws TypeError for non-URL strings', () => {
      assert.throws(() => isValidAimaUrl('not a url at all'), TypeError);
    });

    it('throws TypeError for empty string', () => {
      assert.throws(() => isValidAimaUrl(''), TypeError);
    });

    it('throws TypeError for URL without scheme', () => {
      assert.throws(() => isValidAimaUrl('aima.gov.pt/page'), TypeError);
    });
  });
});
