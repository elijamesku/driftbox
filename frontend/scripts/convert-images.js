const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function convertToWebP() {
  const publicDir = path.join(__dirname, '../public');
  const images = ['driftbox-logo.png', 'logo-2.png', 'logo.png'];
  
  console.log('🖼️  Converting images to WebP format...\n');
  
  for (const image of images) {
    const inputPath = path.join(publicDir, image);
    const outputPath = path.join(publicDir, image.replace('.png', '.webp'));
    
    if (!fs.existsSync(inputPath)) {
      console.log(`⚠️  Skipping ${image} (not found)`);
      continue;
    }
    
    try {
      await sharp(inputPath)
        .webp({ quality: 85, effort: 6 })
        .toFile(outputPath);
      
      const originalSize = fs.statSync(inputPath).size;
      const webpSize = fs.statSync(outputPath).size;
      const savings = ((originalSize - webpSize) / originalSize * 100).toFixed(1);
      
      console.log(`✅ ${image} → ${image.replace('.png', '.webp')}`);
      console.log(`   Original: ${(originalSize / 1024).toFixed(1)} KB`);
      console.log(`   WebP: ${(webpSize / 1024).toFixed(1)} KB`);
      console.log(`   Savings: ${savings}%\n`);
    } catch (error) {
      console.error(`❌ Error converting ${image}:`, error.message);
    }
  }
  
  console.log('✨ Image optimization complete!');
}

convertToWebP().catch(console.error);

