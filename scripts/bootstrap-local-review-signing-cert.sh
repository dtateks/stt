#!/usr/bin/env bash
set -euo pipefail

LOCAL_REVIEW_SIGNING_IDENTITY_DEFAULT="Voice to Text Local Review Signing"
LOCAL_REVIEW_SIGNING_IDENTITY="${STT_LOCAL_REVIEW_SIGNING_IDENTITY:-$LOCAL_REVIEW_SIGNING_IDENTITY_DEFAULT}"
LOCAL_REVIEW_CERT_VALID_DAYS_DEFAULT="3650"
LOCAL_REVIEW_CERT_VALID_DAYS="${STT_LOCAL_REVIEW_CERT_VALID_DAYS:-$LOCAL_REVIEW_CERT_VALID_DAYS_DEFAULT}"
LOGIN_KEYCHAIN_PATH="${HOME}/Library/Keychains/login.keychain-db"
OPENSSL_KEY_PATH_SUFFIX="local-review-signing.key"
OPENSSL_CERT_PATH_SUFFIX="local-review-signing.crt"
OPENSSL_P12_PATH_SUFFIX="local-review-signing.p12"
SIGNING_PROBE_PATH_SUFFIX="codesign-probe"

cleanup_temp_artifacts() {
	if [ -n "${TEMP_DIR:-}" ] && [ -d "$TEMP_DIR" ]; then
		rm -rf "$TEMP_DIR"
	fi
}

trap cleanup_temp_artifacts EXIT

ensure_temp_dir() {
	if [ -z "${TEMP_DIR:-}" ]; then
		TEMP_DIR="$(mktemp -d -t stt-local-review-cert.XXXXXX)"
	fi
}

has_local_review_certificate() {
	local identity_name="$1"
	security find-certificate -a -c "$identity_name" "$LOGIN_KEYCHAIN_PATH" >/dev/null 2>&1
}

can_codesign_with_identity() {
	local identity_name="$1"
	local probe_path

	ensure_temp_dir
	probe_path="$TEMP_DIR/$SIGNING_PROBE_PATH_SUFFIX"
	rm -f "$probe_path"
	cp /usr/bin/true "$probe_path"

	if codesign --force --sign "$identity_name" "$probe_path" >/dev/null 2>&1; then
		rm -f "$probe_path"
		return 0
	fi

	rm -f "$probe_path"
	return 1
}

create_local_review_codesigning_identity() {
	local p12_password
	local key_path
	local cert_path
	local p12_path

	ensure_temp_dir
	p12_password="$(openssl rand -hex 24)"
	key_path="$TEMP_DIR/$OPENSSL_KEY_PATH_SUFFIX"
	cert_path="$TEMP_DIR/$OPENSSL_CERT_PATH_SUFFIX"
	p12_path="$TEMP_DIR/$OPENSSL_P12_PATH_SUFFIX"

	openssl req \
		-x509 \
		-newkey rsa:2048 \
		-keyout "$key_path" \
		-out "$cert_path" \
		-days "$LOCAL_REVIEW_CERT_VALID_DAYS" \
		-nodes \
		-subj "/CN=$LOCAL_REVIEW_SIGNING_IDENTITY" \
		-addext "keyUsage=critical,digitalSignature" \
		-addext "extendedKeyUsage=codeSigning" >/dev/null 2>&1

	openssl pkcs12 \
		-export \
		-legacy \
		-inkey "$key_path" \
		-in "$cert_path" \
		-out "$p12_path" \
		-password "pass:$p12_password" >/dev/null 2>&1

	security import "$p12_path" \
		-k "$LOGIN_KEYCHAIN_PATH" \
		-P "$p12_password" \
		-T /usr/bin/codesign \
		-T /usr/bin/security >/dev/null
}

echo "Checking local-review code-signing identity: $LOCAL_REVIEW_SIGNING_IDENTITY"

if can_codesign_with_identity "$LOCAL_REVIEW_SIGNING_IDENTITY"; then
	echo "Local-review identity already present in login keychain."
	exit 0
fi

if has_local_review_certificate "$LOCAL_REVIEW_SIGNING_IDENTITY"; then
	echo "Local-review certificate exists but is not yet usable for codesign." >&2
	echo "Open Keychain Access and ensure '$LOCAL_REVIEW_SIGNING_IDENTITY' is trusted for code signing, then rerun this script." >&2
	exit 1
fi

echo "Creating local-review signing identity in login keychain..."
create_local_review_codesigning_identity

if can_codesign_with_identity "$LOCAL_REVIEW_SIGNING_IDENTITY"; then
	echo "Created local-review signing identity: $LOCAL_REVIEW_SIGNING_IDENTITY"
	exit 0
fi

echo "Error: failed to create local-review signing identity: $LOCAL_REVIEW_SIGNING_IDENTITY" >&2
exit 1
