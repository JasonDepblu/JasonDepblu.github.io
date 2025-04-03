const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

try {
  // 确保目标目录存在
  const targetDir = path.join(__dirname, '../src/generated');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 读取 YAML 文件
  const navYamlPath = path.join(__dirname, '../_data/navigation.yml');
  if (!fs.existsSync(navYamlPath)) {
    console.error(`Navigation file not found: ${navYamlPath}`);
    console.log('Available files in _data:');
    if (fs.existsSync(path.join(__dirname, '../_data'))) {
      console.log(fs.readdirSync(path.join(__dirname, '../_data')));
    } else {
      console.log('_data directory does not exist');
    }
    process.exit(1);
  }

  const navYaml = fs.readFileSync(navYamlPath, 'utf8');

  // 如果使用 js-yaml 需要先安装它：npm install js-yaml --save-dev
  const navData = yaml.load(navYaml);

  // 创建 JS 文件
  const outputFile = path.join(targetDir, 'navigation.js');
  fs.writeFileSync(
    outputFile,
    `// Auto-generated from navigation.yml\nexport default ${JSON.stringify(navData, null, 2)};\n`
  );

  console.log(`Successfully converted navigation.yml to ${outputFile}`);
} catch (error) {
  console.error('Error converting navigation.yml:', error);
  process.exit(1);
}