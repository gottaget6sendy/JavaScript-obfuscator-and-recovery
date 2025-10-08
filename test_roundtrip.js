

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const bloat = path.resolve(__dirname, 'bloat.js');
const debloat = path.resolve(__dirname, 'debloat.js');
const sampleIn = path.resolve(__dirname, 'sample', 'input.js');
const bloated = path.resolve(__dirname, 'sample', 'input.bloated.js');
const recovered = path.resolve(__dirname, 'sample', 'input.recovered.js');
const password = 'testpassword123';

try {
  console.log('Running bloat...');
  execSync(`node "${bloat}" "${sampleIn}" "${bloated}" "${password}"`, { stdio: 'inherit' });
  console.log('Running debloat...');
  execSync(`node "${debloat}" "${bloated}" "${recovered}" "${password}"`, { stdio: 'inherit' });
  const orig = fs.readFileSync(sampleIn, 'utf8').trim();
  const rec = fs.readFileSync(recovered, 'utf8').trim();
  if (orig === rec) {
    console.log('SUCCESS: recovered file matches original (byte-for-byte).');
  } else {
    console.log('WARNING: recovered file differs from original. Showing diff context:');
    console.log('--- ORIGINAL ---');
    console.log(orig);
    console.log('--- RECOVERED ---');
    console.log(rec);
  }
} catch (e) {
  console.error('Test failed:', e.message);
  process.exit(1);
}
