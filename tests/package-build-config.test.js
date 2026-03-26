const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const packageJson = require("../package.json");

function readFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("mac build config points at entitlement plists for mic access", () => {
  assert.equal(packageJson.build.mac.entitlements, "build/entitlements.mac.plist");
  assert.equal(
    packageJson.build.mac.entitlementsInherit,
    "build/entitlements.mac.inherit.plist"
  );
  assert.equal(packageJson.build.mac.hardenedRuntime, true);
});

test("main mac entitlement plist enables audio input", () => {
  const plist = readFile("build/entitlements.mac.plist");

  assert.match(plist, /<key>com\.apple\.security\.device\.audio-input<\/key>/);
  assert.match(plist, /<key>com\.apple\.security\.cs\.allow-jit<\/key>/);
});

test("inherited mac entitlement plist enables audio input", () => {
  const plist = readFile("build/entitlements.mac.inherit.plist");

  assert.match(plist, /<key>com\.apple\.security\.device\.audio-input<\/key>/);
  assert.match(
    plist,
    /<key>com\.apple\.security\.cs\.allow-unsigned-executable-memory<\/key>/
  );
});

test("installer verifies audio-input entitlement for app and renderer helper", () => {
  const installScript = readFile("install.sh");

  assert.match(installScript, /ensure_audio_input_entitlement/);
  assert.match(
    installScript,
    /Voice to Text Helper \(Renderer\)\.app/
  );
  assert.match(installScript, /com\.apple\.security\.device\.audio-input/);
});
