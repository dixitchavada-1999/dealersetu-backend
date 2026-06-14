# API Testing Guide

This guide will help you test all the API endpoints using Postman or any API testing tool.

## Setup

1. Make sure your server is running:
```bash
npm run dev
```

2. Base URL: `http://localhost:3000`

## Testing Flow

Follow this sequence to test the complete application:

### Step 1: Register Admin (Create Tenant)

This creates your first admin user and tenant.

```
POST http://localhost:3000/api/auth/register
Content-Type: application/json

{
  "name": "Admin User",
  "email": "admin@example.com",
  "password": "admin123"
}
```

**Save the token from the response!**

### Step 2: Login

```
POST http://localhost:3000/api/auth/login
Content-Type: application/json

{
  "email": "admin@example.com",
  "password": "admin123"
}
```

**Copy the token and use it in all subsequent requests.**

### Step 3: Create Category

```
POST http://localhost:3000/api/categories
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json

{
  "name": "Necklace",
  "description": "Gold and diamond necklaces"
}
```

**Save the category _id from response.**

### Step 4: Create Product (Design)

```
POST http://localhost:3000/api/products
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json

{
  "categoryId": "CATEGORY_ID_FROM_STEP_3",
  "name": "Royal Necklace",
  "designCode": "RN-001",
  "description": "Elegant royal design necklace",
  "metalType": "Gold"
}
```

**Save the product _id from response.**

### Step 5: Create Product Variant

```
POST http://localhost:3000/api/variants
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json

{
  "productId": "PRODUCT_ID_FROM_STEP_4",
  "sku": "RN-001-22K-50G",
  "purity": "22K",
  "grossWeight": 52.5,
  "netWeight": 50,
  "stoneWeight": 2.5,
  "metalRate": 5500,
  "makingChargeType": "PerGram",
  "makingChargeValue": 500,
  "wastagePercentage": 8,
  "stonePrice": 5000,
  "gstPercentage": 3,
  "stockQty": 10,
  "attributes": {
    "size": "Medium",
    "color": "Yellow Gold"
  },
  "images": ["image1.jpg", "image2.jpg"]
}
```

**Note: finalPrice is auto-calculated. Save the variant _id.**

### Step 6: Create Customer

```
POST http://localhost:3000/api/customers
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json

{
  "name": "Rajesh Kumar",
  "mobile": "9876543210",
  "email": "rajesh@jewelers.com",
  "shopName": "Rajesh Jewelers",
  "gstNumber": "27AABCU9603R1ZM",
  "address": {
    "line1": "123 MG Road",
    "city": "Mumbai",
    "state": "Maharashtra",
    "pincode": "400001"
  }
}
```

**Save the customer _id from response.**

### Step 7: Create Order

```
POST http://localhost:3000/api/orders
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json

{
  "customerId": "CUSTOMER_ID_FROM_STEP_6",
  "items": [
    {
      "variantId": "VARIANT_ID_FROM_STEP_5",
      "quantity": 2
    }
  ],
  "paidAmount": 300000,
  "notes": "Urgent delivery"
}
```

**This will:**
- Create order
- Create order items
- Deduct stock from variant
- Update customer outstanding amount
- All in a single MongoDB transaction!

### Step 8: View Dashboard

```
GET http://localhost:3000/api/dashboard
Authorization: Bearer YOUR_TOKEN_HERE
```

See all your statistics!

## Full API Endpoint List

### Authentication (Public)

1. **Register Admin**
   - `POST /api/auth/register`
   - Body: `{ name, email, password }`

2. **Login**
   - `POST /api/auth/login`
   - Body: `{ email, password }`

3. **Forgot Password**
   - `POST /api/auth/forgot-password`
   - Body: `{ email }`

4. **Reset Password**
   - `POST /api/auth/reset-password`
   - Body: `{ token, newPassword }`

### Categories (Protected)

5. **Get All Categories**
   - `GET /api/categories`
   - Header: `Authorization: Bearer TOKEN`

6. **Create Category** (Admin only)
   - `POST /api/categories`
   - Body: `{ name, description }`

7. **Update Category** (Admin only)
   - `PUT /api/categories/:id`
   - Body: `{ name?, description?, isActive? }`

8. **Delete Category** (Admin only)
   - `DELETE /api/categories/:id`

### Products (Protected)

9. **Get All Products**
   - `GET /api/products`

10. **Get Single Product**
    - `GET /api/products/:id`

11. **Create Product** (Admin only)
    - `POST /api/products`
    - Body: `{ categoryId, name, designCode, description, metalType }`

12. **Update Product** (Admin only)
    - `PUT /api/products/:id`
    - Body: `{ name?, categoryId?, designCode?, description?, metalType?, isActive? }`

13. **Delete Product** (Admin only)
    - `DELETE /api/products/:id`

### Product Variants (Protected)

14. **Get All Variants**
    - `GET /api/variants`
    - Query: `?productId=xxx` (optional)

15. **Get Single Variant**
    - `GET /api/variants/:id`

16. **Create Variant** (Admin only)
    - `POST /api/variants`
    - Body: See Step 5 above

17. **Update Variant** (Admin only)
    - `PUT /api/variants/:id`
    - Body: Any variant fields

18. **Update Stock** (Admin only)
    - `PATCH /api/variants/:id/stock`
    - Body: `{ stockQty }`

19. **Delete Variant** (Admin only)
    - `DELETE /api/variants/:id`

### Customers (Protected)

20. **Get All Customers**
    - `GET /api/customers`

21. **Get Single Customer**
    - `GET /api/customers/:id`

22. **Create Customer** (Admin only)
    - `POST /api/customers`
    - Body: See Step 6 above

23. **Update Customer** (Admin only)
    - `PUT /api/customers/:id`
    - Body: Any customer fields

24. **Delete Customer** (Admin only)
    - `DELETE /api/customers/:id`

### Orders (Protected)

25. **Get All Orders**
    - `GET /api/orders`

26. **Get Single Order with Items**
    - `GET /api/orders/:id`

27. **Create Order** (Admin only)
    - `POST /api/orders`
    - Body: See Step 7 above

28. **Update Order** (Admin only)
    - `PUT /api/orders/:id`
    - Body: `{ orderStatus?, paymentStatus?, paidAmount?, notes? }`

29. **Cancel Order** (Admin only)
    - `DELETE /api/orders/:id`
    - Restores stock and updates customer outstanding

### Dashboard (Protected)

30. **Get Dashboard Stats**
    - `GET /api/dashboard`

## Common Headers

For all protected routes, include:

```
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

## Price Calculation Example

For a variant with:
- Net Weight: 50g
- Metal Rate: ₹5,500/g
- Wastage: 8%
- Making Charge: ₹500/g (PerGram)
- Stone Price: ₹5,000
- GST: 3%

**Calculation:**
1. Base = 50 × 5,500 = ₹275,000
2. Wastage = 275,000 × 8% = ₹22,000
3. Making = 50 × 500 = ₹25,000
4. Stone = ₹5,000
5. Subtotal = 275,000 + 22,000 + 25,000 + 5,000 = ₹327,000
6. GST = 327,000 × 3% = ₹9,810
7. **Final Price = ₹336,810**

## Testing Order Transaction

To verify the transaction works correctly:

1. Create a variant with stockQty = 10
2. Create an order with quantity = 5
3. Check variant stock (should be 5)
4. Check customer outstandingAmount (should be totalAmount - paidAmount)
5. Cancel the order (DELETE)
6. Check variant stock again (should be restored to 10)
7. Check customer outstandingAmount (should be reduced)

## Error Scenarios to Test

1. **Login with wrong password**
   - Should return 401 Unauthorized

2. **Create product without token**
   - Should return 401 Not authorized, no token

3. **USER role trying to create category**
   - Should return 403 Access denied: Admin only

4. **Create order with insufficient stock**
   - Should return 400 Insufficient stock

5. **Create variant with duplicate SKU**
   - Should return 400 SKU already exists

6. **Access another tenant's data**
   - Should return 403 or 404 (data isolation)

## Postman Tips

1. **Environment Variables**
   - Create variable `baseUrl` = `http://localhost:3000`
   - Create variable `token` = (paste your JWT)
   - Use `{{baseUrl}}` and `{{token}}` in requests

2. **Auto-set Token**
   In Login request, add to Tests tab:
   ```javascript
   pm.environment.set("token", pm.response.json().data.token);
   ```

3. **Save IDs**
   After creating resources:
   ```javascript
   pm.environment.set("categoryId", pm.response.json().data._id);
   pm.environment.set("productId", pm.response.json().data._id);
   ```

## Database Verification

Connect to MongoDB and check:

```javascript
// Check users
db.users.find().pretty()

// Check tenant isolation
db.products.find({ tenantId: ObjectId("YOUR_TENANT_ID") })

// Check order items
db.orderitems.find({ orderId: ObjectId("YOUR_ORDER_ID") })

// Check aggregations
db.orders.aggregate([
  { $group: { _id: "$orderStatus", count: { $sum: 1 } } }
])
```

## Success Criteria

✅ Admin can register and login
✅ Admin can CRUD all resources
✅ USER can only view resources
✅ Data is isolated by tenant
✅ Orders use transactions
✅ Stock is managed correctly
✅ Prices are calculated automatically
✅ Dashboard shows correct statistics

Happy Testing! 🎉

