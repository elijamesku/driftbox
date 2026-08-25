const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, '../node_modules/vscode-icons-js/icons');
const targetDir = path.join(__dirname, '../public/vscode-icons');

// Create target directory if it doesn't exist
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// Copy all SVG files from vscode-icons-js
if (fs.existsSync(sourceDir)) {
  const files = fs.readdirSync(sourceDir);
  files.forEach(file => {
    if (file.endsWith('.svg')) {
      fs.copyFileSync(
        path.join(sourceDir, file),
        path.join(targetDir, file)
      );
    }
  });
  console.log(`✅ Copied ${files.filter(f => f.endsWith('.svg')).length} VS Code icon files`);
} else {
  console.log('⚠️  vscode-icons-js not installed yet. Run npm install first.');
}

