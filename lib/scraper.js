const DEBUG = process.env.DEBUG === 'true';

function formatUrlLabel(url, nome) {
  return nome ? `👤 ${nome}\n${url}` : url;
}

function extractFieldValue($, fieldName) {
  try {
    const elementMappings = {
      'Situação AT/SS': { id: 'P72_VALIDADO', type: 'input' },
      'Última Atualização': { id: 'P72_LAST_UPDATED_AT_DISPLAY', type: 'span' },
      'Estado': { id: 'P72_ESTADO_1', type: 'input' }
    };

    const mapping = elementMappings[fieldName];
    if (!mapping) {
      console.log(`No mapping found for ${fieldName}`);
      return null;
    }

    const { id, type } = mapping;

    if (type === 'input') {
      const inputElement = $(`input#${id}`);
      if (inputElement.length > 0) {
        const value = inputElement.val() || inputElement.attr('value') || '';
        const trimmed = value.trim();
        if (!trimmed) return null;
        if (fieldName === 'Estado') {
          const returnValue = inputElement.attr('data-return-value');
          if (returnValue) {
            const result = `${trimmed} (${returnValue})`;
            if (DEBUG) console.log(`Found ${fieldName} in input ${id}: "${result}"`);
            return result;
          }
        }
        if (DEBUG) console.log(`Found ${fieldName} in input ${id}: "${trimmed}"`);
        return trimmed;
      }
    } else if (type === 'span') {
      const spanElement = $(`span#${id}`);
      if (spanElement.length > 0) {
        const value = spanElement.text().trim();
        if (value) {
          if (DEBUG) console.log(`Found ${fieldName} in span ${id}: "${value}"`);
          return value;
        }
      }
    }

    console.log(`Could not find ${type} element with ID ${id} for ${fieldName}`);
    return null;
  } catch (error) {
    console.error(`Error extracting field ${fieldName}:`, error.message);
    return null;
  }
}

function isPedidoDeferido(estado) {
  return typeof estado === 'string' && /\(6\)\s*$/.test(estado.trim());
}

module.exports = { formatUrlLabel, extractFieldValue, isPedidoDeferido };
