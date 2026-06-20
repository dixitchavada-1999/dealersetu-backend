require('dotenv').config();
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
const src = 'C:/Users/Dixit/Downloads/Gemini_Generated_Image_e5zt7se5zt7se5zt.png';
cloudinary.uploader
  .upload(src, { folder: 'dealersetu/branding', public_id: 'logo-email', overwrite: true })
  .then((r) => {
    console.log('✅ Uploaded');
    console.log('URL:', r.secure_url);
    console.log('Dimensions:', r.width + 'x' + r.height);
  })
  .catch((e) => {
    console.log('❌ Upload failed:', e.message);
    process.exit(1);
  });
