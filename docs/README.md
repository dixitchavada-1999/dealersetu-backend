# Jewelry B2B API

A comprehensive Node.js REST API for managing a Jewelry B2B application with multi-tenant support, role-based access control, and complete inventory management.

## Tech Stack

- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **MongoDB** - Database
- **Mongoose** - ODM
- **JWT** - Authentication
- **bcrypt** - Password hashing
- **MVC Architecture** - Code organization
- **Multi-tenant System** - Tenant isolation

## Features

- ✅ Multi-tenant architecture with tenant isolation
- ✅ Role-based access control (ADMIN/USER)
- ✅ JWT authentication
- ✅ Product design management
- ✅ Product variant with complex pricing calculation
- ✅ Customer (B2B client) management
- ✅ Order management with MongoDB transactions
- ✅ Automatic stock deduction
- ✅ Dashboard analytics
- ✅ Outstanding amount tracking

## Prerequisites

- Node.js (v14 or higher)
- MongoDB (Local or Cloud)
- npm or yarn

## Installation

1. Clone the repository
```bash
git clone <repository-url>
cd api-shop
```

2. Install dependencies
```bash
npm install
```

3. Configure environment variables
```bash
cp env.example .env
```

Edit `.env` and update:
- `MONGO_URI` - Your MongoDB connection string
- `JWT_SECRET` - Your JWT secret key
- `PORT` - Server port (default: 3000)

4. Start the server

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## Project Structure

```
api-shop/
├── src/
│   ├── config/
│   │   └── db.js                 # Database connection
│   ├── controllers/              # Business logic
│   │   ├── authController.js
│   │   ├── categoryController.js
│   │   ├── productController.js
│   │   ├── productVariantController.js
│   │   ├── customerController.js
│   │   ├── orderController.js
│   │   └── dashboardController.js
│   ├── middlewares/              # Custom middleware
│   │   ├── authMiddleware.js
│   │   └── errorMiddleware.js
│   ├── models/                   # Mongoose schemas
│   │   ├── userModel.js
│   │   ├── categoryModel.js
│   │   ├── productModel.js
│   │   ├── productVariantModel.js
│   │   ├── customerModel.js
│   │   ├── orderModel.js
│   │   └── orderItemModel.js
│   ├── routes/                   # API routes
│   │   ├── authRoutes.js
│   │   ├── categoryRoutes.js
│   │   ├── productRoutes.js
│   │   ├── productVariantRoutes.js
│   │   ├── customerRoutes.js
│   │   ├── orderRoutes.js
│   │   └── dashboardRoutes.js
│   ├── utils/
│   │   └── generateToken.js      # JWT utility
│   ├── app.js                    # Express app
│   └── server.js                 # Entry point
├── env.example                   # Environment template
├── package.json
└── README.md
```

## API Endpoints

### Authentication

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/api/auth/register` | Public | Register new admin (tenant owner) |
| POST | `/api/auth/login` | Public | Login user |
| POST | `/api/auth/forgot-password` | Public | Forgot password |
| POST | `/api/auth/reset-password` | Public | Reset password |

### Categories

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/categories` | Private | Get all categories |
| POST | `/api/categories` | Admin | Create category |
| PUT | `/api/categories/:id` | Admin | Update category |
| DELETE | `/api/categories/:id` | Admin | Delete category |

### Products (Designs)

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/products` | Private | Get all products |
| GET | `/api/products/:id` | Private | Get single product |
| POST | `/api/products` | Admin | Create product |
| PUT | `/api/products/:id` | Admin | Update product |
| DELETE | `/api/products/:id` | Admin | Delete product |

### Product Variants (SKUs)

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/variants` | Private | Get all variants (optional ?productId=) |
| GET | `/api/variants/:id` | Private | Get single variant |
| POST | `/api/variants` | Admin | Create variant |
| PUT | `/api/variants/:id` | Admin | Update variant |
| PATCH | `/api/variants/:id/stock` | Admin | Update stock |
| DELETE | `/api/variants/:id` | Admin | Delete variant |

### Customers

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/customers` | Private | Get all customers |
| GET | `/api/customers/:id` | Private | Get single customer |
| POST | `/api/customers` | Admin | Create customer |
| PUT | `/api/customers/:id` | Admin | Update customer |
| DELETE | `/api/customers/:id` | Admin | Delete customer |

### Orders

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/orders` | Private | Get all orders |
| GET | `/api/orders/:id` | Private | Get order with items |
| POST | `/api/orders` | Admin | Create order (with transaction) |
| PUT | `/api/orders/:id` | Admin | Update order |
| DELETE | `/api/orders/:id` | Admin | Cancel order |

### Dashboard

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/dashboard` | Private | Get dashboard statistics |

## Request/Response Examples

### 1. Register Admin

**Request:**
```json
POST /api/auth/register
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "64f5a1b2c3d4e5f6a7b8c9d0",
    "tenantId": "64f5a1b2c3d4e5f6a7b8c9d1",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "ADMIN",
    "isActive": true,
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### 2. Login

**Request:**
```json
POST /api/auth/login
{
  "email": "john@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "64f5a1b2c3d4e5f6a7b8c9d0",
    "tenantId": "64f5a1b2c3d4e5f6a7b8c9d1",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "ADMIN",
    "isActive": true,
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### 3. Create Category

**Request:**
```json
POST /api/categories
Headers: { "Authorization": "Bearer <token>" }
{
  "name": "Necklace",
  "description": "Beautiful necklaces"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "64f5a1b2c3d4e5f6a7b8c9d2",
    "tenantId": "64f5a1b2c3d4e5f6a7b8c9d1",
    "name": "Necklace",
    "description": "Beautiful necklaces",
    "isActive": true,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### 4. Create Product (Design)

**Request:**
```json
POST /api/products
Headers: { "Authorization": "Bearer <token>" }
{
  "categoryId": "64f5a1b2c3d4e5f6a7b8c9d2",
  "name": "Royal Necklace",
  "designCode": "RN-001",
  "description": "Elegant royal design",
  "metalType": "Gold"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "64f5a1b2c3d4e5f6a7b8c9d3",
    "tenantId": "64f5a1b2c3d4e5f6a7b8c9d1",
    "categoryId": {
      "_id": "64f5a1b2c3d4e5f6a7b8c9d2",
      "name": "Necklace",
      "description": "Beautiful necklaces"
    },
    "name": "Royal Necklace",
    "designCode": "RN-001",
    "description": "Elegant royal design",
    "metalType": "Gold",
    "isActive": true,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### 5. Create Product Variant

**Request:**
```json
POST /api/variants
Headers: { "Authorization": "Bearer <token>" }
{
  "productId": "64f5a1b2c3d4e5f6a7b8c9d3",
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
  "stockQty": 5,
  "attributes": {
    "size": "Medium",
    "color": "Yellow Gold"
  },
  "images": ["image1.jpg", "image2.jpg"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "64f5a1b2c3d4e5f6a7b8c9d4",
    "tenantId": "64f5a1b2c3d4e5f6a7b8c9d1",
    "productId": {
      "_id": "64f5a1b2c3d4e5f6a7b8c9d3",
      "name": "Royal Necklace",
      "designCode": "RN-001",
      "metalType": "Gold"
    },
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
    "finalPrice": 315650,
    "stockQty": 5,
    "attributes": {
      "size": "Medium",
      "color": "Yellow Gold"
    },
    "images": ["image1.jpg", "image2.jpg"],
    "isActive": true,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Price Calculation:**
- Base Price = netWeight × metalRate = 50 × 5500 = 275,000
- Wastage = 275,000 × 8% = 22,000
- Making Charge = netWeight × makingChargeValue = 50 × 500 = 25,000
- Stone Price = 5,000
- Subtotal = 275,000 + 22,000 + 25,000 + 5,000 = 327,000
- GST = 327,000 × 3% = 9,810
- **Final Price = 336,810**

### 6. Create Customer

**Request:**
```json
POST /api/customers
Headers: { "Authorization": "Bearer <token>" }
{
  "name": "Rajesh Jewelers",
  "mobile": "9876543210",
  "email": "rajesh@jewelers.com",
  "shopName": "Rajesh Jewelers Pvt Ltd",
  "gstNumber": "27AABCU9603R1ZM",
  "address": {
    "line1": "123 MG Road",
    "city": "Mumbai",
    "state": "Maharashtra",
    "pincode": "400001"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "64f5a1b2c3d4e5f6a7b8c9d5",
    "tenantId": "64f5a1b2c3d4e5f6a7b8c9d1",
    "name": "Rajesh Jewelers",
    "mobile": "9876543210",
    "email": "rajesh@jewelers.com",
    "shopName": "Rajesh Jewelers Pvt Ltd",
    "gstNumber": "27AABCU9603R1ZM",
    "address": {
      "line1": "123 MG Road",
      "city": "Mumbai",
      "state": "Maharashtra",
      "pincode": "400001"
    },
    "outstandingAmount": 0,
    "isActive": true,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### 7. Create Order

**Request:**
```json
POST /api/orders
Headers: { "Authorization": "Bearer <token>" }
{
  "customerId": "64f5a1b2c3d4e5f6a7b8c9d5",
  "items": [
    {
      "variantId": "64f5a1b2c3d4e5f6a7b8c9d4",
      "quantity": 2
    }
  ],
  "paidAmount": 300000,
  "notes": "Urgent delivery required"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "order": {
      "_id": "64f5a1b2c3d4e5f6a7b8c9d6",
      "tenantId": "64f5a1b2c3d4e5f6a7b8c9d1",
      "orderNumber": "ORD-1704067200000-456",
      "customerId": {
        "_id": "64f5a1b2c3d4e5f6a7b8c9d5",
        "name": "Rajesh Jewelers",
        "mobile": "9876543210",
        "shopName": "Rajesh Jewelers Pvt Ltd"
      },
      "orderDate": "2024-01-01T00:00:00.000Z",
      "totalAmount": 631300,
      "paidAmount": 300000,
      "paymentStatus": "Partial",
      "orderStatus": "Placed",
      "notes": "Urgent delivery required",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    },
    "items": [
      {
        "_id": "64f5a1b2c3d4e5f6a7b8c9d7",
        "tenantId": "64f5a1b2c3d4e5f6a7b8c9d1",
        "orderId": "64f5a1b2c3d4e5f6a7b8c9d6",
        "variantId": {
          "_id": "64f5a1b2c3d4e5f6a7b8c9d4",
          "sku": "RN-001-22K-50G",
          "purity": "22K",
          "productId": {
            "_id": "64f5a1b2c3d4e5f6a7b8c9d3",
            "name": "Royal Necklace",
            "designCode": "RN-001"
          }
        },
        "quantity": 2,
        "grossWeight": 52.5,
        "netWeight": 50,
        "pricePerUnit": 315650,
        "totalPrice": 631300,
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

### 8. Get Dashboard Stats

**Request:**
```
GET /api/dashboard
Headers: { "Authorization": "Bearer <token>" }
```

**Response:**
```json
{
  "success": true,
  "data": {
    "counts": {
      "categories": 5,
      "products": 25,
      "variants": 78,
      "customers": 15,
      "orders": 42
    },
    "revenue": {
      "total": 5250000,
      "paid": 4500000,
      "outstanding": 750000
    },
    "inventory": {
      "totalStockValue": 12500000,
      "lowStockItems": 8
    },
    "ordersByStatus": {
      "Placed": 10,
      "Processing": 15,
      "Completed": 15,
      "Cancelled": 2
    },
    "ordersByPayment": {
      "Pending": 8,
      "Partial": 12,
      "Paid": 22
    }
  }
}
```

## Authentication

All protected routes require a JWT token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## Error Responses

All errors follow this format:

```json
{
  "message": "Error description",
  "stack": "Error stack trace (development only)"
}
```

Common HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Internal Server Error

## Key Features Explained

### 1. Multi-Tenancy
Each admin registration creates a new `tenantId`. All data is isolated by tenant, ensuring complete separation between different businesses.

### 2. Role-Based Access Control
- **ADMIN**: Full CRUD access to all resources
- **USER**: Read-only access (can view but not modify)

### 3. Product Variant Pricing
The system automatically calculates `finalPrice` based on:
- Net weight × Metal rate
- Wastage percentage
- Making charges (per gram or fixed)
- Stone price
- GST percentage

### 4. Order Transactions
Order creation uses MongoDB transactions to ensure:
- Order and OrderItems are created together
- Stock is deducted atomically
- Customer outstanding is updated
- Rollback on any error

### 5. Stock Management
- Stock is managed at the variant level
- Automatic deduction during order creation
- Stock restoration on order cancellation

## Database Schema

### User
- tenantId (ObjectId)
- name (String)
- email (String, unique)
- password (String, hashed)
- role (ADMIN | USER)
- isActive (Boolean)

### Category
- tenantId (ObjectId)
- name (String)
- description (String)
- isActive (Boolean)

### Product
- tenantId (ObjectId)
- categoryId (ObjectId ref Category)
- name (String)
- designCode (String, unique)
- description (String)
- metalType (Gold | Silver | Platinum)
- isActive (Boolean)

### ProductVariant
- tenantId (ObjectId)
- productId (ObjectId ref Product)
- sku (String, unique)
- purity (22K | 18K | 14K | 925)
- grossWeight, netWeight, stoneWeight (Number)
- metalRate, makingChargeValue (Number)
- makingChargeType (PerGram | Fixed)
- wastagePercentage, gstPercentage (Number)
- stonePrice, finalPrice (Number)
- stockQty (Number)
- attributes (Object)
- images (Array)
- isActive (Boolean)

### Customer
- tenantId (ObjectId)
- name, mobile, email (String)
- shopName, gstNumber (String)
- address (Object)
- outstandingAmount (Number)
- isActive (Boolean)

### Order
- tenantId (ObjectId)
- orderNumber (String, unique)
- customerId (ObjectId ref Customer)
- orderDate (Date)
- totalAmount, paidAmount (Number)
- paymentStatus (Pending | Partial | Paid)
- orderStatus (Placed | Processing | Completed | Cancelled)
- notes (String)

### OrderItem
- tenantId (ObjectId)
- orderId (ObjectId ref Order)
- variantId (ObjectId ref ProductVariant)
- quantity (Number)
- grossWeight, netWeight (Number)
- pricePerUnit, totalPrice (Number)

## Development

Run in development mode with auto-reload:
```bash
npm run dev
```

## Production Deployment

1. Set `NODE_ENV=production` in your `.env`
2. Use a strong `JWT_SECRET`
3. Use MongoDB connection string with authentication
4. Consider using PM2 or similar for process management

## Security Best Practices

- ✅ Passwords are hashed with bcrypt
- ✅ JWT tokens expire after 30 days
- ✅ Helmet.js for security headers
- ✅ CORS enabled
- ✅ Input validation on all endpoints
- ✅ Tenant isolation for data security
- ✅ Role-based access control

## License

ISC

## Support

For issues or questions, please contact the development team.

