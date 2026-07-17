const LEGACY_PORTAL_HOSTNAME = 'services.aima.gov.pt';
const SESSION_PARAM = 'session';

class LegacyPortalError extends Error {
  constructor() {
    super('URL is from the legacy AIMA portal (services.aima.gov.pt) and is not supported');
    this.name = 'LegacyPortalError';
  }
}

class AuthenticatedLinkError extends Error {
  constructor() {
    super('URL is an authenticated portal session link and is not publicly accessible');
    this.name = 'AuthenticatedLinkError';
  }
}

function isValidAimaUrl(url) {
  const parsed = new URL(url);

  if (parsed.hostname !== 'aima.gov.pt' && !parsed.hostname.endsWith('.aima.gov.pt')) {
    throw new Error('URL is not from aima.gov.pt domain');
  }

  if (parsed.hostname === LEGACY_PORTAL_HOSTNAME) {
    throw new LegacyPortalError();
  }

  // APEX session-scoped links carry a `session` id (usually alongside a `cs` checksum).
  // They only resolve while the issuing session is alive, so they are useless for monitoring.
  if (parsed.searchParams.has(SESSION_PARAM)) {
    throw new AuthenticatedLinkError();
  }

  return parsed;
}

function isLegacyPortalUrl(url) {
  try {
    return new URL(url).hostname === LEGACY_PORTAL_HOSTNAME;
  } catch {
    return false;
  }
}

function isAuthenticatedLinkUrl(url) {
  try {
    return new URL(url).searchParams.has(SESSION_PARAM);
  } catch {
    return false;
  }
}

module.exports = {
  isValidAimaUrl,
  isLegacyPortalUrl,
  isAuthenticatedLinkUrl,
  LegacyPortalError,
  AuthenticatedLinkError,
};
