const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidAimaUrl,
  isLegacyPortalUrl,
  isTrackingPortalUrl,
  isAuthenticatedLinkUrl,
  LegacyPortalError,
  TrackingPortalError,
  AuthenticatedLinkError,
} = require('../lib/validate-url');

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

  describe('legacy portal rejection', () => {
    it('rejects services.aima.gov.pt/RAR/2fase URLs', () => {
      assert.throws(
        () => isValidAimaUrl('https://services.aima.gov.pt/RAR/2fase/sumario.php'),
        LegacyPortalError
      );
    });

    it('rejects services.aima.gov.pt/RAR/qrrep_deferido URLs with query params', () => {
      assert.throws(
        () => isValidAimaUrl('https://services.aima.gov.pt/RAR/qrrep_deferido/cid.php?h=abc&n=123'),
        LegacyPortalError
      );
    });

    it('rejects bare services.aima.gov.pt', () => {
      assert.throws(
        () => isValidAimaUrl('https://services.aima.gov.pt/'),
        LegacyPortalError
      );
    });
  });

  describe('tracking portal rejection', () => {
    it('rejects contactenos.aima.gov.pt tracking URLs', () => {
      assert.throws(
        () => isValidAimaUrl('https://contactenos.aima.gov.pt/tracking/6fab12b8-bbc0-4e2b-a89a-d2422b96705a'),
        TrackingPortalError
      );
    });

    it('rejects bare contactenos.aima.gov.pt', () => {
      assert.throws(
        () => isValidAimaUrl('https://contactenos.aima.gov.pt/'),
        TrackingPortalError
      );
    });

    it('rejects tracking URLs regardless of query params', () => {
      assert.throws(
        () => isValidAimaUrl('https://contactenos.aima.gov.pt/tracking/abc?lang=pt'),
        TrackingPortalError
      );
    });
  });

  describe('authenticated session link rejection', () => {
    it('rejects a cidadao document link with session and cs params', () => {
      assert.throws(
        () => isValidAimaUrl(
          'https://portal-renovacoes.aima.gov.pt/ords/r/aima/aima-pr/cidadao?p3_pedido_id=233342&p3_documento=PortalRenovacoes_Recibos%2FRenovacaoTituloResidencia%2F10125672%2Frecibo_233342.pdf&session=2926835542928&cs=1L3HCS3QtL'
        ),
        AuthenticatedLinkError
      );
    });

    it('rejects a session link on any aima.gov.pt host', () => {
      assert.throws(
        () => isValidAimaUrl('https://aima.gov.pt/ords/r/aima/aima-pr/cidadao?session=123'),
        AuthenticatedLinkError
      );
    });

    it('accepts a QR validar link that has no session param', () => {
      const parsed = isValidAimaUrl(
        'https://portal-renovacoes.aima.gov.pt/ords/r/aima/aima-pr/validar?p71_lang=pt&p72_link=VALIDATE&p72_token=abc123'
      );
      assert.equal(parsed.searchParams.get('p72_token'), 'abc123');
    });

    it('prefers the legacy portal error when both signals are present', () => {
      assert.throws(
        () => isValidAimaUrl('https://services.aima.gov.pt/RAR/2fase/sumario.php?session=123'),
        LegacyPortalError
      );
    });
  });

  describe('isAuthenticatedLinkUrl', () => {
    it('returns true for a session-scoped portal URL', () => {
      assert.equal(
        isAuthenticatedLinkUrl('https://portal-renovacoes.aima.gov.pt/ords/r/aima/aima-pr/cidadao?p3_pedido_id=1&session=123&cs=abc'),
        true
      );
    });

    it('returns false for a QR validar URL', () => {
      assert.equal(
        isAuthenticatedLinkUrl('https://portal-renovacoes.aima.gov.pt/ords/r/aima/aima-pr/validar?p72_token=abc123'),
        false
      );
    });

    it('does not match params that merely contain "session"', () => {
      assert.equal(
        isAuthenticatedLinkUrl('https://portal-renovacoes.aima.gov.pt/ords/r/aima/aima-pr/validar?p_session_note=x'),
        false
      );
    });

    it('returns false for malformed URLs', () => {
      assert.equal(isAuthenticatedLinkUrl('not a url'), false);
    });
  });

  describe('isLegacyPortalUrl', () => {
    it('returns true for services.aima.gov.pt URLs', () => {
      assert.equal(isLegacyPortalUrl('https://services.aima.gov.pt/RAR/2fase/sumario.php'), true);
    });

    it('returns false for the new portal', () => {
      assert.equal(
        isLegacyPortalUrl('https://portal-renovacoes.aima.gov.pt/ords/r/aima/aima-pr/validar'),
        false
      );
    });

    it('returns false for malformed URLs', () => {
      assert.equal(isLegacyPortalUrl('not a url'), false);
    });
  });

  describe('isTrackingPortalUrl', () => {
    it('returns true for contactenos.aima.gov.pt URLs', () => {
      assert.equal(
        isTrackingPortalUrl('https://contactenos.aima.gov.pt/tracking/6fab12b8-bbc0-4e2b-a89a-d2422b96705a'),
        true
      );
    });

    it('returns false for the renewals portal', () => {
      assert.equal(
        isTrackingPortalUrl('https://portal-renovacoes.aima.gov.pt/ords/r/aima/aima-pr/validar'),
        false
      );
    });

    it('returns false for malformed URLs', () => {
      assert.equal(isTrackingPortalUrl('not a url'), false);
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
