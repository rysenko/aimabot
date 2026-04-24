const LEGACY_PORTAL_HOSTNAME = 'services.aima.gov.pt';

class LegacyPortalError extends Error {
  constructor() {
    super('URL is from the legacy AIMA portal (services.aima.gov.pt) and is not supported');
    this.name = 'LegacyPortalError';
  }
}

/**
 * Validates that a URL belongs to the AIMA domain.
 * Throws on invalid format or non-AIMA domain.
 */
function isValidAimaUrl(url) {
  const parsed = new URL(url); // throws TypeError on malformed URL

  if (parsed.hostname !== 'aima.gov.pt' && !parsed.hostname.endsWith('.aima.gov.pt')) {
    throw new Error('URL is not from aima.gov.pt domain');
  }

  if (parsed.hostname === LEGACY_PORTAL_HOSTNAME) {
    throw new LegacyPortalError();
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

module.exports = { isValidAimaUrl, isLegacyPortalUrl, LegacyPortalError };
