const EmailVariable = require('../models/emailVariableModel');

/** Load all global custom email variables as a { key: value } map. */
async function getGlobalVarsMap() {
  try {
    const vars = await EmailVariable.find().lean();
    return vars.reduce((acc, v) => {
      acc[v.key] = v.value;
      return acc;
    }, {});
  } catch (err) {
    console.error('getGlobalVarsMap failed:', err.message);
    return {};
  }
}

module.exports = { getGlobalVarsMap };
