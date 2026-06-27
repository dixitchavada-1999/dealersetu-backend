const express = require('express');
const router = express.Router();
const {
    registerAdmin,
    loginUser,
    autoLogin,
    logout,
    refreshAccessToken,
    updatePassword,
    forgotPassword,
    resetPassword,
    loginWithCode,
    switchTenant,
    sendOtp,
    verifyOtp,
    activateAccount,
    updateProfile,
    addBusiness,
    getMyBusinesses,
    setBusinessVisibility,
    setBusinessDeactivated,
} = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');

// @route   POST /api/auth/register
// @desc    Register new user
// @access  Public
router.post('/register', registerAdmin);

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', loginUser);

// @route   POST /api/auth/login-code
// @desc    Login with code (team members)
// @access  Public
router.post('/login-code', loginWithCode);

// @route   POST /api/auth/send-otp
// @desc    Send OTP to customer's mobile number
// @access  Public
router.post('/send-otp', sendOtp);

// @route   POST /api/auth/verify-otp
// @desc    Verify OTP and login customer
// @access  Public
router.post('/verify-otp', verifyOtp);

// @route   POST /api/auth/activate-account
// @desc    Activate customer account (first-time code + set password)
// @access  Public
router.post('/activate-account', activateAccount);

// @route   POST /api/auth/auto-login
// @desc    Auto-login with device ID
// @access  Public
router.post('/auto-login', autoLogin);

// @route   POST /api/auth/logout
// @desc    Logout user (clear device ID)
// @access  Public
router.post('/logout', logout);

// @route   POST /api/auth/refresh-token
// @desc    Refresh access token
// @access  Public
router.post('/refresh-token', refreshAccessToken);

// @route   POST /api/auth/update-password
// @desc    Update password
// @access  Private (requires authentication)
router.post('/update-password', protect, updatePassword);

// @route   POST /api/auth/update-profile
// @desc    Update own profile (name, email, mobileNumber)
// @access  Private
router.post('/update-profile', protect, updateProfile);

// @route   POST /api/auth/forgot-password
// @desc    Forgot password
// @access  Public
router.post('/forgot-password', forgotPassword);

// @route   POST /api/auth/reset-password
// @desc    Reset password
// @access  Public
router.post('/reset-password', resetPassword);

// @route   POST /api/auth/switch-tenant
// @desc    Switch tenant for customer
// @access  Private
router.post('/switch-tenant', protect, switchTenant);

// @route   POST /api/auth/add-business
// @desc    Add another owner/business via activation code (logged-in customer)
// @access  Private (Customer)
router.post('/add-business', protect, addBusiness);

// @route   GET /api/auth/my-businesses
// @desc    List the customer's owners/businesses (incl. hidden/deactivated)
// @access  Private (Customer)
router.get('/my-businesses', protect, getMyBusinesses);

// @route   PUT /api/auth/my-businesses/:tenantId/visibility
// @desc    Hide/show an owner's products for the customer
// @access  Private (Customer)
router.put('/my-businesses/:tenantId/visibility', protect, setBusinessVisibility);

// @route   PUT /api/auth/my-businesses/:tenantId/deactivate
// @desc    Deactivate/reactivate an owner relationship (notifies owner)
// @access  Private (Customer)
router.put('/my-businesses/:tenantId/deactivate', protect, setBusinessDeactivated);

// @route   PUT /api/auth/push-token
// @desc    Register Expo push token
// @access  Private
const { registerPushToken } = require('../controllers/authController');
router.put('/push-token', protect, registerPushToken);

module.exports = router;
