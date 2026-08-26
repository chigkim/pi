git checkout screenreader || exit /b 1
git fetch --all || exit /b 1
git reset --hard origin/screenreader || exit /b 1
call npm install || exit /b 1
call npm run build || exit /b 1
call npm install -g ./packages/coding-agent || exit /b 1
