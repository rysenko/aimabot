/**
 * Validates that a URL belongs to the AIMA domain.
 * Throws on invalid format or non-AIMA domain.
 */
function isValidAimaUrl(url) {
  const parsed = new URL(url); // throws TypeError on malformed URL

  if (parsed.hostname !== 'aima.gov.pt' && !parsed.hostname.endsWith('.aima.gov.pt')) {
    throw new Error('URL is not from aima.gov.pt domain');
  }

  return parsed;
}

module.exports = { isValidAimaUrl };
