const LEGACY_PORTAL_HOSTNAME = 'services.aima.gov.pt';
const TRACKING_PORTAL_HOSTNAME = 'contactenos.aima.gov.pt';
const SESSION_PARAM = 'session';

class LegacyPortalError extends Error {
  constructor() {
    super('URL is from the legacy AIMA portal (services.aima.gov.pt) and is not supported');
    this.name = 'LegacyPortalError';
  }
}

class TrackingPortalError extends Error {
  constructor() {
    super('URL is from the AIMA process/card tracking portal (contactenos.aima.gov.pt) and is not supported');
    this.name = 'TrackingPortalError';
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

  // Process/card tracking portal — a separate system with no monitorable fields.
  if (parsed.hostname === TRACKING_PORTAL_HOSTNAME) {
    throw new TrackingPortalError();
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

function isTrackingPortalUrl(url) {
  try {
    return new URL(url).hostname === TRACKING_PORTAL_HOSTNAME;
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
  isTrackingPortalUrl,
  isAuthenticatedLinkUrl,
  LegacyPortalError,
  TrackingPortalError,
  AuthenticatedLinkError,
};
