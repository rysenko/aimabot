const LEGACY_PORTAL_HOSTNAME = 'services.aima.gov.pt';
const TRACKING_PORTAL_HOSTNAME = 'contactenos.aima.gov.pt';
const SESSION_PARAM = 'session';

// Public status pages on the contact portal: /tracking/<uuid>
const TRACKING_PATH_RE =
  /^\/tracking\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

class LegacyPortalError extends Error {
  constructor() {
    super('URL is from the legacy AIMA portal (services.aima.gov.pt) and is not supported');
    this.name = 'LegacyPortalError';
  }
}

class TrackingPortalError extends Error {
  constructor() {
    super('URL is on the AIMA contact portal (contactenos.aima.gov.pt) but is not a /tracking/<id> status link');
    this.name = 'TrackingPortalError';
  }
}

class AuthenticatedLinkError extends Error {
  constructor() {
    super('URL is an authenticated portal session link and is not publicly accessible');
    this.name = 'AuthenticatedLinkError';
  }
}

function parse(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function tokenFrom(parsed) {
  if (!parsed || parsed.hostname !== TRACKING_PORTAL_HOSTNAME) return null;
  const match = TRACKING_PATH_RE.exec(parsed.pathname);
  return match ? match[1].toLowerCase() : null;
}

function isValidAimaUrl(url) {
  const parsed = new URL(url);

  if (parsed.hostname !== 'aima.gov.pt' && !parsed.hostname.endsWith('.aima.gov.pt')) {
    throw new Error('URL is not from aima.gov.pt domain');
  }

  if (parsed.hostname === LEGACY_PORTAL_HOSTNAME) {
    throw new LegacyPortalError();
  }

  // Only the public /tracking/<uuid> status pages of the contact portal are monitorable;
  // the rest of that host (contact form, uploads, session links) is not.
  if (parsed.hostname === TRACKING_PORTAL_HOSTNAME) {
    if (!tokenFrom(parsed)) throw new TrackingPortalError();
    return parsed;
  }

  // APEX session-scoped links carry a `session` id (usually alongside a `cs` checksum).
  // They only resolve while the issuing session is alive, so they are useless for monitoring.
  if (parsed.searchParams.has(SESSION_PARAM)) {
    throw new AuthenticatedLinkError();
  }

  return parsed;
}

function isLegacyPortalUrl(url) {
  const parsed = parse(url);
  return !!parsed && parsed.hostname === LEGACY_PORTAL_HOSTNAME;
}

// A monitorable process/card tracking status page.
function isTrackingStatusUrl(url) {
  return tokenFrom(parse(url)) !== null;
}

// On the contact portal host, but not a status page — nothing to monitor there.
function isUnsupportedTrackingPortalUrl(url) {
  const parsed = parse(url);
  return !!parsed && parsed.hostname === TRACKING_PORTAL_HOSTNAME && !tokenFrom(parsed);
}

function getTrackingToken(url) {
  return tokenFrom(parse(url));
}

function isAuthenticatedLinkUrl(url) {
  const parsed = parse(url);
  return !!parsed && parsed.searchParams.has(SESSION_PARAM);
}

module.exports = {
  isValidAimaUrl,
  isLegacyPortalUrl,
  isTrackingStatusUrl,
  isUnsupportedTrackingPortalUrl,
  getTrackingToken,
  isAuthenticatedLinkUrl,
  LegacyPortalError,
  TrackingPortalError,
  AuthenticatedLinkError,
};
