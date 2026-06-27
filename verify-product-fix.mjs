// Verify the product-create fix: two products with BLANK productCode (the 2nd
// used to 500 on the sparse-unique index). Mimics the real form payload.
import http from 'node:http';
const PORT = Number(process.env.PORT || 3001);
const SUF = String(Date.now()).slice(-6);
const call = (path, method, body, headers = {}) => new Promise((res) => {
  const data = body ? JSON.stringify(body) : null;
  const r = http.request({ host: 'localhost', port: PORT, path, method, headers: { 'Content-Type': 'application/json', ...headers } }, (rs) => {
    let b = ''; rs.on('data', (c) => (b += c)); rs.on('end', () => res({ status: rs.statusCode, body: b }));
  });
  r.on('error', (e) => res({ status: 0, body: e.message }));
  if (data) r.write(data); r.end();
});

const reg = await call('/api/auth/register', 'POST', { firstName: 'V', lastName: 'P', email: `vp.${SUF}@example.com`, userName: `vp${SUF}`, password: 'Test@1234', mobileNumber: `92${SUF}1`, businessName: `VP ${SUF}` });
const token = JSON.parse(reg.body)?.data?.tokens?.accessToken;
const auth = { Authorization: `Bearer ${token}` };
const cat = await call('/api/categories', 'POST', { name: `VP Cat ${SUF}` }, auth);
const catId = JSON.parse(cat.body)?.data?._id || JSON.parse(cat.body)?.data?.id;

// Exact shape the form sends for a non-variant product, with BLANK productCode/brand.
const formPayload = (n) => ({ name: `VP Prod ${SUF} ${n}`, categoryId: catId, productCode: '', description: '', brand: '', unit: 'Piece', hasVariants: false, taxPercentage: 0, imageUrls: [], price: 250, sku: `SKU-${SUF}-${n}`, stockQty: 100, variantAttributes: [] });

const p1 = await call('/api/products', 'POST', formPayload(1), auth);
const p2 = await call('/api/products', 'POST', formPayload(2), auth);
console.log(`Product #1 (blank productCode): ${p1.status} ${p1.status === 201 ? 'OK' : 'FAIL — ' + p1.body.slice(0, 200)}`);
console.log(`Product #2 (blank productCode): ${p2.status} ${p2.status === 201 ? 'OK ✅ (this used to 500)' : 'FAIL — ' + p2.body.slice(0, 200)}`);
console.log(p1.status === 201 && p2.status === 201 ? '\n✅ FIX CONFIRMED — blank productCode no longer collides.' : '\n❌ Still broken.');
