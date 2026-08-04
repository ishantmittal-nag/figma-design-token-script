// cleanup-temp.js
const { execSync } = require('child_process');

function cleanupTempFiles() {
  execSync('rm -rf /tmp/*');
  execSync('rm -rf ' + process.env.HOME + '/.cache');
}

cleanupTempFiles();
