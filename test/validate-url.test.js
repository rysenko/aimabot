const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidAimaUrl,
  isLegacyPortalUrl,
  isTrackingStatusUrl,
  isUnsupportedTrackingPortalUrl,
  getTrackingToken,
  isAuthenticatedLinkUrl,
  LegacyPortalError,
  TrackingPortalError,
  AuthenticatedLinkError,
} = require('../lib/validate-url');

const TRACKING_URL = 'https://contactenos.aima.gov.pt/tracking/00000000-0000-0000-0000-000000000000';

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

  describe('contact portal tracking pages', () => {
    it('accepts a /tracking/<uuid> status URL', () => {
      const parsed = isValidAimaUrl(TRACKING_URL);
      assert.equal(parsed.hostname, 'contactenos.aima.gov.pt');
    });

    it('accepts a tracking URL with a trailing slash and query params', () => {
      const parsed = isValidAimaUrl(`${TRACKING_URL}/?lang=pt`);
      assert.equal(parsed.hostname, 'contactenos.aima.gov.pt');
    });

    it('rejects bare contactenos.aima.gov.pt', () => {
      assert.throws(() => isValidAimaUrl('https://contactenos.aima.gov.pt/'), TrackingPortalError);
    });

    it('rejects other pages on the contact portal', () => {
      assert.throws(() => isValidAimaUrl('https://contactenos.aima.gov.pt/contact-form'), TrackingPortalError);
      assert.throws(() => isValidAimaUrl('https://contactenos.aima.gov.pt/submission/00000000-0000-0000-0000-000000000000'), TrackingPortalError);
    });

    it('rejects a tracking path whose token is not a uuid', () => {
      assert.throws(() => isValidAimaUrl('https://contactenos.aima.gov.pt/tracking/abc?lang=pt'), TrackingPortalError);
    });

    it('rejects a tracking path with extra segments', () => {
      assert.throws(() => isValidAimaUrl(`${TRACKING_URL}/extra`), TrackingPortalError);
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

  describe('isTrackingStatusUrl', () => {
    it('returns true for a /tracking/<uuid> URL', () => {
      assert.equal(isTrackingStatusUrl(TRACKING_URL), true);
    });

    it('returns false for other contact portal pages', () => {
      assert.equal(isTrackingStatusUrl('https://contactenos.aima.gov.pt/contact-form'), false);
    });

    it('returns false for the renewals portal', () => {
      assert.equal(
        isTrackingStatusUrl('https://portal-renovacoes.aima.gov.pt/ords/r/aima/aima-pr/validar'),
        false
      );
    });

    it('returns false for a /tracking/ path on another aima host', () => {
      assert.equal(isTrackingStatusUrl('https://aima.gov.pt/tracking/00000000-0000-0000-0000-000000000000'), false);
    });

    it('returns false for malformed URLs', () => {
      assert.equal(isTrackingStatusUrl('not a url'), false);
    });
  });

  describe('isUnsupportedTrackingPortalUrl', () => {
    it('returns true for non-tracking contact portal pages', () => {
      assert.equal(isUnsupportedTrackingPortalUrl('https://contactenos.aima.gov.pt/upload'), true);
    });

    it('returns false for a valid tracking URL', () => {
      assert.equal(isUnsupportedTrackingPortalUrl(TRACKING_URL), false);
    });

    it('returns false for other hosts', () => {
      assert.equal(isUnsupportedTrackingPortalUrl('https://portal-renovacoes.aima.gov.pt/x'), false);
    });

    it('returns false for malformed URLs', () => {
      assert.equal(isUnsupportedTrackingPortalUrl('not a url'), false);
    });
  });

  describe('getTrackingToken', () => {
    it('extracts the token from a tracking URL', () => {
      assert.equal(getTrackingToken(TRACKING_URL), '00000000-0000-0000-0000-000000000000');
    });

    it('lowercases the token', () => {
      assert.equal(
        getTrackingToken('https://contactenos.aima.gov.pt/tracking/00A76D6B-F233-45CD-ACFE-35FC5685E1B7'),
        '00a76d6b-f233-45cd-acfe-35fc5685e1b7'
      );
    });

    it('returns null for non-tracking URLs', () => {
      assert.equal(getTrackingToken('https://contactenos.aima.gov.pt/'), null);
      assert.equal(getTrackingToken('not a url'), null);
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
