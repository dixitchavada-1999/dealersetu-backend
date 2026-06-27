// Reproduce the POST /api/products 500 and print the error body.
import http from 'node:http';
const SUF = String(Date.now()).slice(-6);
const call = (path, method, body, headers = {}) => new Promise((res) => {
  const data = body ? JSON.stringify(body) : null;
  const r = http.request({ host: 'localhost', port: 3000, path, method, headers: { 'Content-Type': 'application/json', ...headers } }, (rs) => {
    let b = ''; rs.on('data', (c) => (b += c)); rs.on('end', () => res({ status: rs.statusCode, body: b }));
  });
  r.on('error', (e) => res({ status: 0, body: e.message }));
  if (data) r.write(data); r.end();
});

const reg = await call('/api/auth/register', 'POST', { firstName: 'R', lastName: 'P', email: `rp.${SUF}@example.com`, userName: `rp${SUF}`, password: 'Test@1234', mobileNumber: `93${SUF}1`, businessName: `RP ${SUF}` });
const token = JSON.parse(reg.body)?.data?.tokens?.accessToken;
const auth = { Authorization: `Bearer ${token}` };
const cat = await call('/api/categories', 'POST', { name: `RP Cat ${SUF}` }, auth);
const catId = JSON.parse(cat.body)?.data?._id || JSON.parse(cat.body)?.data?.id;
console.log(`register ${reg.status}, category ${cat.status} (id ${catId})`);

const payloads = [
  { label: 'non-variant', body: { name: `RP Prod ${SUF}`, categoryId: catId, hasVariants: false, price: 250, stockQty: 100, sku: `SKU-${SUF}` } },
  { label: 'minimal', body: { name: `RP Prod2 ${SUF}`, categoryId: catId } },
];
for (const p of payloads) {
  const r = await call('/api/products', 'POST', p.body, auth);
  console.log(`\n[${p.label}] POST /api/products -> ${r.status}`);
  console.log(r.body.slice(0, 800));
}
