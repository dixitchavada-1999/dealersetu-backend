/* Test the expanded email-template endpoints (vars, create, delete, preview-globals). */
const BASE = 'http://localhost:3000';
let token = null;
async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, json };
}
(async () => {
  token = (await api('POST', '/api/auth/login', { email: 'superadmin@platform.com', password: 'SuperAdmin123!' })).json?.data?.tokens?.accessToken;
  console.log(`login: ${token ? '✅' : '❌'}`);

  // Global variables
  const addVar = await api('POST', '/api/super-admin/email-templates/variables', { key: 'companyName', value: 'DealerSetu Pvt Ltd', description: 'Company legal name' });
  console.log(`add global var: ${addVar.ok ? '✅' : '❌ ' + JSON.stringify(addVar.json)}`);
  const listVars = await api('GET', '/api/super-admin/email-templates/variables');
  console.log(`list vars: ${listVars.ok ? '✅ ' + listVars.json.data.map(v => v.key).join(',') : '❌'}`);

  // Preview should resolve {{companyName}} from globals
  const preview = await api('POST', '/api/super-admin/email-templates/preview', { subject: 'x', heading: 'H', bodyTop: 'From {{companyName}}, code:', highlightKey: 'otp', footerText: 'f' });
  console.log(`preview resolves global var: ${preview.json?.data?.html?.includes('DealerSetu Pvt Ltd') ? '✅' : '❌'}`);

  // Edit placeholders list of password_reset
  const editPh = await api('PUT', '/api/super-admin/email-templates/password_reset', { placeholders: ['otp', 'name', 'companyName'] });
  console.log(`edit placeholders: ${editPh.ok && editPh.json.data.placeholders.includes('companyName') ? '✅' : '❌'}`);

  // Create new template
  const create = await api('POST', '/api/super-admin/email-templates', { key: 'test_welcome', name: 'Test Welcome', subject: 'Welcome {{name}}', heading: 'Hi', bodyTop: 'Welcome!', placeholders: ['name'] });
  console.log(`create template: ${create.status === 201 ? '✅' : '❌ ' + JSON.stringify(create.json)}`);

  // Delete it
  const del = await api('DELETE', '/api/super-admin/email-templates/test_welcome');
  console.log(`delete template: ${del.ok ? '✅' : '❌'}`);

  // Cleanup the test var
  await api('DELETE', '/api/super-admin/email-templates/variables/companyName');
  console.log('\n🎉 V2 endpoints tested.');
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
