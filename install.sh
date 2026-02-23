#!/bin/bash
set -e

echo "Installing Voice Everywhere..."

# Clone if not already in the repo
if [ ! -f "package.json" ] || ! grep -q '"voice-everywhere"' package.json 2>/dev/null; then
  git clone https://github.com/hungson175/voice-everywhere.git
  cd voice-everywhere
fi

npm install --no-fund --no-audit
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir
rm -rf /Applications/Voice\ Everywhere.app 2>/dev/null
cp -R dist/mac-arm64/Voice\ Everywhere.app /Applications/

echo ""
echo "Voice Everywhere installed to /Applications!"
echo "Opening..."
open /Applications/Voice\ Everywhere.app
