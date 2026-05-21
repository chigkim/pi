git checkout screenreader
git fetch --all
git reset --hard origin/screenreader
npm install
npm run build
npm install -g ./packages/coding-agent
