# Quick Start Guide

## 🚀 Setup (5 minutes)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Create a `.env` file in the root directory:

```env
NODE_ENV=development
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/api-shop
JWT_SECRET=your_super_secret_jwt_key_change_this
```

**For Cloud MongoDB:**
```env
MONGO_URI=mongodb+srv://dixitchavada1999_db_user:inh6c6OcwnPkOfM3@dev-cluster.521ewe8.mongodb.net/?appName=dev-cluster
```

### 3. Start Server
```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

You should see:
```
Server running in development mode on port 3000
MongoDB Connected: localhost
Database: api-shop
```

## 🧪 Quick Test

### 1. Check API is Running
```bash
curl http://localhost:3000
```

Response:
```json
{
  "success": true,
  "message": "Jewelry B2B API is running",
  "version": "1.0.0"
}
```

### 2. Register First Admin
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Admin User",
    "email": "admin@test.com",
    "password": "admin123"
  }'
```

Save the `token` from response!

### 3. Create a Category
```bash
curl -X POST http://localhost:3000/api/categories \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Rings",
    "description": "Gold and diamond rings"
  }'
```

### 4. View Dashboard
```bash
curl http://localhost:3000/api/dashboard \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 📦 What's Included

### Models (7)
- ✅ User (Multi-tenant, RBAC)
- ✅ Category
- ✅ Product (Design level)
- ✅ ProductVariant (SKU with auto-pricing)
- ✅ Customer (B2B clients)
- ✅ Order (Parent)
- ✅ OrderItem (Child)

### Controllers (7)
- ✅ Authentication
- ✅ Category CRUD
- ✅ Product CRUD
- ✅ Product Variant CRUD
- ✅ Customer CRUD
- ✅ Order CRUD (with transactions)
- ✅ Dashboard Analytics

### Features
- ✅ JWT Authentication
- ✅ Role-based Access (ADMIN/USER)
- ✅ Multi-tenant Data Isolation
- ✅ Automatic Price Calculation
- ✅ Stock Management
- ✅ Order Transactions
- ✅ Outstanding Amount Tracking

## 📚 Documentation Files

1. **README.md** - Complete documentation with all endpoints
2. **API_TESTING_GUIDE.md** - Step-by-step testing guide
3. **QUICK_START.md** - This file
4. **env.example** - Environment variables template

## 🔑 Default Credentials

After registration, use these credentials:
- **Email**: (the one you registered with)
- **Password**: (the one you set)
- **Role**: ADMIN (first user is always admin)

## 📊 API Endpoints Overview

### Public (No Auth)
- POST `/api/auth/register` - Register admin
- POST `/api/auth/login` - Login
- POST `/api/auth/forgot-password` - Forgot password
- POST `/api/auth/reset-password` - Reset password

### Protected (Require Auth)
- GET/POST/PUT/DELETE `/api/categories`
- GET/POST/PUT/DELETE `/api/products`
- GET/POST/PUT/PATCH/DELETE `/api/variants`
- GET/POST/PUT/DELETE `/api/customers`
- GET/POST/PUT/DELETE `/api/orders`
- GET `/api/dashboard`

## 🛠️ Development Commands

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run in production mode
npm start

# Check for updates
npm outdated

# Update dependencies
npm update
```

## 🐛 Troubleshooting

### Port already in use
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Change port in .env
PORT=3001
```

### MongoDB connection error
```bash
# Check MongoDB is running (local)
mongod --version

# Start MongoDB service (Windows)
net start MongoDB

# Check connection string in .env
MONGO_URI=mongodb://127.0.0.1:27017/api-shop
```

### JWT token expired
- Token expires after 30 days
- Login again to get a new token

### Linter errors
```bash
# All code is already linted
# No errors present
```

## 🔒 Security Checklist

- ✅ Passwords are hashed with bcrypt
- ✅ JWT tokens with expiration
- ✅ Helmet.js for security headers
- ✅ CORS enabled
- ✅ Input validation
- ✅ Tenant isolation
- ✅ Role-based access control
- ⚠️ Change JWT_SECRET in production!
- ⚠️ Use strong passwords
- ⚠️ Use HTTPS in production

## 📈 Next Steps

1. ✅ Setup complete
2. ✅ Test basic endpoints
3. ⏭️ Create sample data
4. ⏭️ Test order creation with transactions
5. ⏭️ Test role-based access (create USER role)
6. ⏭️ Integrate with frontend
7. ⏭️ Deploy to production

## 💡 Tips

- Use Postman for easier testing
- Set up environment variables in Postman
- Create test data in sequence: Category → Product → Variant → Customer → Order
- Check MongoDB Compass to verify data
- Monitor server logs for debugging
- Use `npm run dev` during development for auto-reload

## 📞 Support

For detailed API documentation, see **README.md**

For testing guide, see **API_TESTING_GUIDE.md**

For issues:
- Check server logs
- Verify MongoDB connection
- Ensure JWT token is valid
- Check request payload format

---

**Happy Coding! 🎉**

Time to build something amazing! 🚀

