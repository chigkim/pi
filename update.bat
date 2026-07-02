git checkout screenreader
git fetch --all
git reset --hard origin/screenreader
call npm install
call npm run build
call npm install -g ./packages/coding-agent
