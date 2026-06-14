# Postman Collection Setup Guide

આ guide તમને Postman collection import અને use કરવા માટે મદદ કરશે.

## 📦 Files Included

1. **Jewelry_B2B_API.postman_collection.json** - Complete API collection with 30+ requests
2. **Jewelry_B2B_API.postman_environment.json** - Environment variables

---

## 🚀 Quick Setup (3 Steps)

### Step 1: Import Collection

1. Postman ખોલો
2. **Import** button પર click કરો (top-left)
3. **Jewelry_B2B_API.postman_collection.json** file select કરો
4. Click "Import"

✅ Collection આપના Postman માં add થઈ જશે!

### Step 2: Import Environment

1. Top-right માં **Environments** icon પર click કરો
2. **Import** click કરો
3. **Jewelry_B2B_API.postman_environment.json** file select કરો
4. Click "Import"
5. Environment select કરો dropdown માંથી

✅ Environment variables ready છે!

### Step 3: Start Server

```bash
cd C:\Users\Dixit\OneDrive\Desktop\myApp\api-shop
npm run dev
```

✅ Server running on http://localhost:3000

---

## 🎯 Testing Flow

### Step 1: Register Admin (First Time Only)

1. Collection માં જાઓ: **Authentication → Register Admin**
2. Click "Send"
3. Response માંથી **token** automatically environment માં save થશે

**Dummy Data:**
- Name: Dixit Chavada
- Email: admin@jewelryshop.com
- Password: Admin@123

### Step 2: Login (Next Times)

1. **Authentication → Login**
2. Click "Send"
3. Token automatically save થશે

### Step 3: Create Sample Data

સરળતાથી test કરવા માટે, આ order માં execute કરો:

#### A. Create Categories
```
Categories → Create Category - Rings
Categories → Create Category - Necklace  
Categories → Create Category - Bangles
```

#### B. Create Products
```
Products → Create Product - Royal Ring
Products → Create Product - Necklace
```

#### C. Create Variants
```
Product Variants → Create Variant - 22K Gold
Product Variants → Create Variant - 18K Gold
Product Variants → Create Variant - Necklace
```

#### D. Create Customers
```
Customers → Create Customer - Rajesh Jewelers
Customers → Create Customer - Surat Gold
Customers → Create Customer - Ahmedabad Jewels
```

#### E. Create Order
```
Orders → Create Order - Single Item
```

#### F. View Dashboard
```
Dashboard → Get Dashboard Statistics
```

---

## 📊 Collection Structure

### 1. Authentication (4 requests)
- ✅ Register Admin (saves token automatically)
- ✅ Login (saves token automatically)
- ✅ Forgot Password
- ✅ Reset Password

### 2. Categories (6 requests)
- Get All Categories
- Create Category - Rings (saves categoryId)
- Create Category - Necklace
- Create Category - Bangles
- Update Category
- Delete Category

### 3. Products (6 requests)
- Get All Products
- Get Single Product
- Create Product - Royal Ring (saves productId)
- Create Product - Necklace
- Update Product
- Delete Product

### 4. Product Variants (10 requests)
- Get All Variants
- Get Variants by Product (filtered)
- Get Single Variant
- Create Variant - 22K Gold (saves variantId)
- Create Variant - 18K Gold
- Create Variant - Necklace
- Update Variant
- Update Stock Only
- Delete Variant

### 5. Customers (6 requests)
- Get All Customers
- Get Single Customer
- Create Customer - Rajesh Jewelers (saves customerId)
- Create Customer - Surat Gold
- Create Customer - Ahmedabad Jewels
- Update Customer
- Delete Customer

### 6. Orders (7 requests)
- Get All Orders
- Get Single Order with Items
- Create Order - Single Item (saves orderId)
- Create Order - Multiple Items
- Update Order Status
- Mark Order Complete
- Cancel Order (restores stock)

### 7. Dashboard (1 request)
- Get Dashboard Statistics

**Total: 40 requests with realistic dummy data!**

---

## 🔧 Environment Variables

Collection automatically manage કરે છે:

| Variable | Description | Auto-saved? |
|----------|-------------|-------------|
| `baseUrl` | Server URL (localhost:3000) | ✅ |
| `authToken` | JWT token | ✅ Yes |
| `tenantId` | Your tenant ID | ✅ Yes |
| `userId` | Your user ID | ✅ Yes |
| `categoryId` | Last created category | ✅ Yes |
| `productId` | Last created product | ✅ Yes |
| `variantId` | Last created variant | ✅ Yes |
| `customerId` | Last created customer | ✅ Yes |
| `orderId` | Last created order | ✅ Yes |

**Note:** Token અને IDs automatically save થાય છે, તમારે manually કશું કરવાનું નથી!

---

## 💡 Smart Features

### Auto-save Token
Register અથવા Login કર્યા પછી, token automatically save થાય છે. બધા requests માં automatically use થશે.

### Auto-save IDs
જ્યારે તમે category, product, variant, customer, અથવા order create કરો છો, તેની ID automatically save થાય છે. Next requests માં use કરી શકો.

### Pre-filled Data
બધા requests માં realistic dummy data already filled છે. Direct "Send" click કરી શકો!

---

## 🧪 Complete Test Scenario

### Scenario: એક jewelry shop માટે order બનાવો

**Step 1: Register as Admin**
```
Authentication → Register Admin
```
Email: admin@jewelryshop.com

**Step 2: Create Category**
```
Categories → Create Category - Rings
```
Save થશે: categoryId

**Step 3: Create Product**
```
Products → Create Product - Royal Ring
```
Use થશે: categoryId (from step 2)
Save થશે: productId

**Step 4: Create Variant**
```
Product Variants → Create Variant - 22K Gold
```
Use થશે: productId (from step 3)
Save થશે: variantId
Data:
- SKU: RDR-001-22K-5G
- Weight: 5g
- Stock: 15 pieces
- **Price auto-calculated!** 📊

**Step 5: Create Customer**
```
Customers → Create Customer - Rajesh Jewelers
```
Save થશે: customerId
Shop: Rajesh Jewelers Pvt Ltd
Location: Mumbai

**Step 6: Create Order**
```
Orders → Create Order - Single Item
```
Use થશે: customerId, variantId
Quantity: 3 pieces
Paid: ₹50,000
**Transaction થશે:**
- ✅ Order created
- ✅ OrderItems created
- ✅ Stock deducted (15 → 12)
- ✅ Outstanding calculated

**Step 7: Check Dashboard**
```
Dashboard → Get Dashboard Statistics
```
તમારો complete data દેખાશે! 📈

---

## 🎨 Dummy Data Examples

### Product Variant Pricing
```json
{
  "netWeight": 5,
  "metalRate": 5800,
  "wastagePercentage": 10,
  "makingChargeValue": 600,
  "stonePrice": 8000,
  "gstPercentage": 3
}
```

**Auto-calculated Price:**
- Base: 5 × 5800 = ₹29,000
- Wastage: 10% = ₹2,900
- Making: 5 × 600 = ₹3,000
- Stone: ₹8,000
- GST: 3% = ₹1,287
- **Final: ₹44,187** ✨

### Customer Data
```json
{
  "name": "Rajesh Kumar",
  "mobile": "9876543210",
  "shopName": "Rajesh Jewelers Pvt Ltd",
  "gstNumber": "27AABCU9603R1ZM",
  "address": {
    "city": "Mumbai",
    "state": "Maharashtra"
  }
}
```

### Order Data
```json
{
  "items": [
    {
      "variantId": "{{variantId}}",
      "quantity": 3
    }
  ],
  "paidAmount": 50000,
  "notes": "Urgent delivery required"
}
```

---

## 🔍 Tips & Tricks

### 1. View Environment Variables
- Top-right → Eye icon 👁️
- બધા saved variables દેખાશે

### 2. Manual Token Set (if needed)
```
Environment → authToken → paste your token
```

### 3. Test in Sequence
પહેલા create કરો, પછી get/update કરો:
1. Categories → Products → Variants
2. Customers
3. Orders

### 4. Response માંથી data copy કરો
Response માં IDs automatically save થાય છે, પણ manual પણ copy કરી શકો.

### 5. Console Check કરો
Postman console (bottom) માં auto-save messages જોશો:
```
Token saved: eyJhbGciOiJIUzI1NiIsInR5cCI6...
```

---

## ⚠️ Common Issues

### Issue 1: "Not authorized, no token"
**Solution:** 
1. First Login/Register કરો
2. Token automatically save થશે
3. Retry your request

### Issue 2: "Category not found"
**Solution:**
1. First category create કરો
2. CategoryId automatically save થશે
3. Then product create કરો

### Issue 3: "Insufficient stock"
**Solution:**
1. Variant create કરતી વખતે stockQty વધારો
2. અથવા order માં quantity ઓછી કરો

### Issue 4: Server not responding
**Solution:**
```bash
# Check if server is running
npm run dev
```

---

## 📱 Mobile Testing

Postman mobile app માં પણ use કરી શકો:
1. Collection cloud માં sync કરો
2. Mobile app માં login કરો
3. Same collection access કરો

---

## 🎓 Learning Resources

### Understanding Requests

1. **GET** - Data fetch કરે છે
   - Example: Get All Products

2. **POST** - New data create કરે છે
   - Example: Create Category

3. **PUT** - Existing data update કરે છે
   - Example: Update Product

4. **PATCH** - Partial update
   - Example: Update Stock Only

5. **DELETE** - Data remove કરે છે
   - Example: Delete Variant

### Headers
બધી protected requests માં automatically add થાય છે:
```
Authorization: Bearer {{authToken}}
Content-Type: application/json
```

---

## 🚀 Advanced Usage

### Run All Tests
Collection → Right-click → "Run collection"
બધા requests automatically execute થશે!

### Export Results
Tests → Results → Export
Excel માં data export કરી શકો.

### Share Collection
Collection → Share → Get public link
Team members સાથે share કરો.

---

## ✅ Success Checklist

- [x] Collection imported
- [x] Environment imported & selected
- [x] Server running on localhost:3000
- [x] Admin registered successfully
- [x] Token saved automatically
- [x] Sample category created
- [x] Sample product created
- [x] Sample variant created (price auto-calculated)
- [x] Sample customer created
- [x] Sample order created (transaction successful)
- [x] Dashboard shows data

---

## 📞 Support

### Questions?
1. Check **README.md** - Complete API documentation
2. Check **API_TESTING_GUIDE.md** - Detailed testing guide
3. Check **QUICK_START.md** - Quick setup guide

### Found an Issue?
- Server logs check કરો
- MongoDB connection verify કરો
- Token valid છે કે નહીં check કરો

---

**🎉 Happy Testing!**

Collection ready છે, enjoy testing your Jewelry B2B API! 💎

---

## 📝 Quick Reference

### Base URL
```
http://localhost:3000
```

### Test Credentials
```
Email: admin@jewelryshop.com
Password: Admin@123
```

### Total Requests: 40
- Public: 4 (Auth)
- Protected: 36 (with dummy data)

### Auto-save: ✅
- Token
- Tenant ID
- All resource IDs

**Everything is ready to use! Just import and start testing!** 🚀

