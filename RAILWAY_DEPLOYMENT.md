# Railway Deployment Guide

## ✅ Code Fixes Applied

Your backend code has been reviewed and fixed for Railway deployment. Here are the changes made:

### 1. **CORS Configuration** ✅
- Updated to handle production environments properly
- Allows configuration via `ALLOWED_ORIGINS` environment variable
- Development mode allows all origins

### 2. **Database Connection** ✅
- Updated error messages to mention Railway
- Better error handling for production

### 3. **Static File Serving** ✅
- Fixed for Railway's ephemeral filesystem
- In production, files should use Cloudinary (not local storage)
- Local storage only works in development

### 4. **File Upload** ✅
- Automatically uses Cloudinary in production
- Falls back to local storage in development
- Proper error handling

### 5. **Server Configuration** ✅
- Listens on `0.0.0.0` (required for Railway)
- Proper error handling for unhandled rejections
- Better logging

### 6. **Node.js Version** ✅
- Updated to Node.js >= 18.0.0 (Railway requirement)

---

## 🚀 Railway Deployment Steps

### Step 1: Prepare Your Code
1. Make sure all changes are committed:
   ```bash
   git add .
   git commit -m "Fix Railway deployment issues"
   git push
   ```

### Step 2: Create Railway Project
1. Go to [Railway.app](https://railway.app)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Connect your GitHub account
5. Select your repository
6. Select the `api-shop` folder (or root if it's a monorepo)

### Step 3: Set Environment Variables in Railway

Go to your Railway project → **Variables** tab and add:

#### Required Variables:
```
NODE_ENV=production
MONGO_URI=your_mongodb_atlas_connection_string
JWT_SECRET=your_strong_random_secret_key
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret
```

#### Optional Variables:
```
ALLOWED_ORIGINS=https://yourapp.com,https://www.yourapp.com
PORT=3000 (Railway sets this automatically, but you can override)
```

### Step 4: Generate JWT Secret

Run this command to generate a secure JWT secret:
```bash
openssl rand -base64 32
```
Copy the output and use it as `JWT_SECRET` in Railway.

### Step 5: MongoDB Atlas Setup

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free cluster (if you don't have one)
3. Go to **Database Access** → Create a database user
4. Go to **Network Access** → Add IP `0.0.0.0/0` (allow all IPs)
5. Go to **Database** → Click **Connect** → Choose **Connect your application**
6. Copy the connection string
7. Replace `<password>` with your database user password
8. Add this as `MONGO_URI` in Railway

Example:
```
mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority
```

### Step 6: Cloudinary Setup

1. Go to [Cloudinary Console](https://cloudinary.com/console)
2. Sign up or log in
3. Go to **Dashboard**
4. Copy:
   - **Cloud Name** → `CLOUDINARY_CLOUD_NAME`
   - **API Key** → `CLOUDINARY_API_KEY`
   - **API Secret** → `CLOUDINARY_API_SECRET`
5. Add these to Railway environment variables

### Step 7: Deploy

1. Railway will automatically detect your `package.json`
2. It will run `npm install` and `npm start`
3. Check the **Deployments** tab for build logs
4. Once deployed, Railway will give you a URL like: `https://yourapp.railway.app`

### Step 8: Test Your API

1. Visit: `https://yourapp.railway.app/`
2. You should see:
   ```json
   {
     "success": true,
     "message": "Jewelry B2B API is running",
     "version": "1.0.0"
   }
   ```

---

## 🔍 Troubleshooting

### Issue: Build Fails
- **Check:** Node.js version in `package.json` (should be >= 18.0.0)
- **Check:** All dependencies are in `dependencies` (not `devDependencies`)
- **Check:** Railway logs for specific error messages

### Issue: Server Won't Start
- **Check:** `MONGO_URI` is set correctly
- **Check:** MongoDB Atlas allows connections from Railway IPs
- **Check:** `JWT_SECRET` is set
- **Check:** Railway logs for error messages

### Issue: File Uploads Don't Work
- **Check:** Cloudinary credentials are set correctly
- **Check:** `NODE_ENV=production` is set
- **Check:** Cloudinary dashboard for uploaded files

### Issue: CORS Errors
- **Check:** `ALLOWED_ORIGINS` is set correctly
- **Check:** Frontend is using the correct API URL
- **Check:** CORS configuration in `app.js`

### Issue: Database Connection Fails
- **Check:** MongoDB Atlas Network Access allows `0.0.0.0/0`
- **Check:** Database user has correct permissions
- **Check:** Connection string format is correct
- **Check:** Password doesn't have special characters (URL encode if needed)

---

## 📝 Important Notes

1. **File Storage**: Railway has an ephemeral filesystem. Files uploaded to local storage will be lost on restart. Always use Cloudinary in production.

2. **Environment Variables**: Never commit `.env` file. Use Railway's environment variables instead.

3. **Port**: Railway automatically sets `PORT` environment variable. Your code should use `process.env.PORT || 3000`.

4. **Database**: Use MongoDB Atlas (cloud) for production. Local MongoDB won't work on Railway.

5. **Logs**: Check Railway's **Deployments** tab for real-time logs.

---

## ✅ Checklist Before Deploying

- [ ] All code changes committed and pushed
- [ ] `NODE_ENV=production` set in Railway
- [ ] `MONGO_URI` set to MongoDB Atlas connection string
- [ ] `JWT_SECRET` set to a strong random string
- [ ] Cloudinary credentials configured
- [ ] MongoDB Atlas network access allows all IPs
- [ ] Tested locally with production environment variables
- [ ] Frontend API URL updated to Railway URL

---

## 🎉 After Deployment

1. Update your frontend `lib/api.ts` to use Railway URL:
   ```typescript
   // Production
   return 'https://yourapp.railway.app';
   ```

2. Test all API endpoints
3. Monitor Railway logs for any errors
4. Set up custom domain (optional) in Railway settings

---

## 📞 Need Help?

If you encounter any issues:
1. Check Railway deployment logs
2. Check MongoDB Atlas connection
3. Verify all environment variables are set
4. Test API endpoints with Postman/curl

Good luck with your deployment! 🚀

