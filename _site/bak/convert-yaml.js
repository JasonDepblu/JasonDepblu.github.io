const fs = require('fs');
const yaml = require('js-yaml');

const navYaml = fs.readFileSync('./_data/navigation.yml', 'utf8');
const navData = yaml.load(navYaml);

fs.writeFileSync(
  './src/generated/navigation.js',
  `export default ${JSON.stringify(navData, null, 2)};`
);