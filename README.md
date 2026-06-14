# Jewelry B2B REST API 💎

Complete backend REST API for Jewelry B2B business with multi-tenant support, role-based access control, and automatic pricing calculations.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Configure environment
# Copy env.example to .env and update values
cp env.example .env

# Start server
npm run dev
```

Server will run on: **http://localhost:3000**

## 📚 Documentation

Complete documentation છે `docs/` folder માં:

### 📖 Core Documentation
- **[QUICK_START.md](docs/QUICK_START.md)** - 5 minute setup guide
- **[README.md](docs/README.md)** - Complete API documentation with examples
- **[API_TESTING_GUIDE.md](docs/API_TESTING_GUIDE.md)** - Step-by-step testing guide
- **[PROJECT_SUMMARY.md](docs/PROJECT_SUMMARY.md)** - Complete project overview

### 🔧 Postman Collection
- **[POSTMAN_GUIDE.md](docs/POSTMAN_GUIDE.md)** - Postman setup guide (Gujarati + English)
- **Jewelry_B2B_API.postman_collection.json** - Import આ file Postman માં
- **Jewelry_B2B_API.postman_environment.json** - Environment variables

## ✨ Features

- 🔐 **JWT Authentication** - Secure login with 30-day tokens
- 👥 **Role-Based Access** - ADMIN (full access) & USER (read-only)
- 🏢 **Multi-Tenant** - Complete data isolation between businesses
- 💰 **Auto Price Calculation** - Complex jewelry pricing (metal + wastage + making + stone + GST)
- 📦 **Stock Management** - Automatic stock deduction on orders
- 🔄 **MongoDB Transactions** - Atomic order creation with rollback
- 📊 **Analytics Dashboard** - Complete business statistics
- 💳 **Outstanding Tracking** - Customer payment tracking

## 🎯 Tech Stack

- **Node.js** + **Express.js** - Backend framework
- **MongoDB** + **Mongoose** - Database
- **JWT** + **bcrypt** - Security
- **MVC Architecture** - Clean code structure

## 📦 What's Included

### Models (7)
- User, Category, Product, ProductVariant, Customer, Order, OrderItem

### Controllers (7)
- Auth, Category, Product, Variant, Customer, Order, Dashboard

### Routes (7)
- Complete REST API with 30+ endpoints

### Middlewares (2)
- JWT authentication + RBAC

## 🔌 API Endpoints

### Public
- `POST /api/auth/register` - Register admin
- `POST /api/auth/login` - Login

### Protected (Require Auth)
- `/api/categories` - Category CRUD
- `/api/products` - Product CRUD
- `/api/variants` - Variant CRUD (with auto-pricing)
- `/api/customers` - Customer CRUD
- `/api/orders` - Order CRUD (with transactions)
- `/api/dashboard` - Analytics

## 🧪 Testing with Postman

1. **Import Collection**
   - Postman → Import → Select `Jewelry_B2B_API.postman_collection.json`

2. **Import Environment**
   - Postman → Environments → Import → Select `Jewelry_B2B_API.postman_environment.json`

3. **Start Testing**
   - Register Admin → Token auto-saves
   - Create sample data with one click
   - 40+ requests with realistic dummy data

**[Complete Postman Guide](docs/POSTMAN_GUIDE.md)** (Gujarati)

## 📊 Database

### Local
```
mongodb://127.0.0.1:27017/api-shop
```

### Cloud (Dev)
```
mongodb+srv://dixitchavada1999_db_user:***@dev-cluster.521ewe8.mongodb.net/?appName=dev-cluster
```

Configure in `.env` file.

## 🔑 Example Request

### Register Admin
```bash
POST http://localhost:3000/api/auth/register
Content-Type: application/json

{
  "name": "Dixit Chavada",
  "email": "admin@shop.com",
  "password": "Admin@123"
}
```

### Create Product Variant (Auto Price!)
```bash
POST http://localhost:3000/api/variants
Authorization: Bearer YOUR_TOKEN

{
  "productId": "...",
  "sku": "RDR-001-22K-5G",
  "purity": "22K",
  "netWeight": 5,
  "metalRate": 5800,
  "makingChargeType": "PerGram",
  "makingChargeValue": 600,
  "wastagePercentage": 10,
  "stonePrice": 8000,
  "gstPercentage": 3,
  "stockQty": 15
}

// finalPrice automatically calculated! 💰
```

## 📖 Full Documentation

For complete API documentation with all endpoints, request/response examples, and detailed explanations:

👉 **[View Complete Documentation](docs/README.md)**

## 🎓 Project Structure

```
jewelry-b2b-api/
├── docs/                      # 📚 All documentation
│   ├── README.md              # Complete API docs
│   ├── QUICK_START.md         # Quick setup
│   ├── API_TESTING_GUIDE.md   # Testing guide
│   ├── POSTMAN_GUIDE.md       # Postman guide (Gujarati)
│   └── PROJECT_SUMMARY.md     # Project overview
│
├── src/
│   ├── models/                # 7 Mongoose schemas
│   ├── controllers/           # 7 Business logic
│   ├── routes/                # 7 API routes
│   ├── middlewares/           # Auth + Error handling
│   ├── config/                # DB connection
│   └── utils/                 # JWT helper
│
├── Jewelry_B2B_API.postman_collection.json     # 40+ API requests
├── Jewelry_B2B_API.postman_environment.json    # Environment vars
├── env.example                # Environment template
└── package.json               # Dependencies
```

## ✅ Status

- ✅ All requirements implemented (100%)
- ✅ No linter errors
- ✅ Production ready
- ✅ Well documented
- ✅ Postman collection included
- ✅ Dummy data provided

## 🚀 Next Steps

1. ✅ Setup complete (follow QUICK_START.md)
2. ✅ Import Postman collection
3. ✅ Test with dummy data
4. ⏭️ Build frontend
5. ⏭️ Deploy to production

## 🔒 Security

- ✅ Passwords hashed with bcrypt
- ✅ JWT tokens (30-day expiry)
- ✅ Helmet.js security headers
- ✅ CORS enabled
- ✅ Input validation
- ✅ Tenant isolation
- ✅ Role-based access

## 📞 Support & Documentation

- **Quick Setup**: [QUICK_START.md](docs/QUICK_START.md)
- **API Reference**: [README.md](docs/README.md)
- **Testing Guide**: [API_TESTING_GUIDE.md](docs/API_TESTING_GUIDE.md)
- **Postman Guide**: [POSTMAN_GUIDE.md](docs/POSTMAN_GUIDE.md) (Gujarati)
- **Project Info**: [PROJECT_SUMMARY.md](docs/PROJECT_SUMMARY.md)

## 📝 License

ISC

---

**Built with ❤️ for Jewelry B2B businesses**

Made by: Dixit Chavada

