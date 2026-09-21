//! Dropbox implementation of [`BackupStorageProvider`], plus the one-time OAuth2 PKCE "connect
//! your account" flow (not part of the trait — see the module doc in `cloud/mod.rs`).
//!
//! Setup required before this can do anything real: a Dropbox app registered at
//! <https://www.dropbox.com/developers/apps> with "App folder" access, the
//! `files.content.write`/`files.content.read`/`account_info.read` scopes enabled, and
//! `http://127.0.0.1/callback` (loopback, any port — see `connect` below) allowed as a redirect
//! URI. The resulting "App key" is a public OAuth client identifier (not a secret — PKCE is
//! specifically designed so installed apps never need to embed a client secret), entered by the
//! user in Settings and stored in the database like any other setting.
//!
//! Authentication state: only the OAuth **refresh token** is persisted, in the OS keyring (never
//! in the SQLite database or anywhere else) — see `crate::commands::cloud_backup` for where it's
//! read/written. Access tokens are short-lived and are never cached: every operation on this
//! provider exchanges the refresh token for a fresh access token first. Backups are infrequent,
//! so the extra round trip is a fine trade for not having to track expiry.

use std::path::Path;
use std::time::Duration;

use rand::distr::{Alphanumeric, SampleString};
use serde::Deserialize;

use super::{BackupStorageProvider, ProviderError, RemoteBackupHandle};

const DROPBOX_AUTHORIZE_URL: &str = "https://www.dropbox.com/oauth2/authorize";
const DEFAULT_API_BASE: &str = "https://api.dropboxapi.com";
const DEFAULT_CONTENT_BASE: &str = "https://content.dropboxapi.com";

const MAX_RETRIES: u32 = 3;

// --- PKCE -------------------------------------------------------------------------------------

fn generate_code_verifier() -> String {
    // RFC 7636 requires 43-128 characters from [A-Z a-z 0-9 - . _ ~]; a plain alphanumeric
    // string of length 64 is comfortably within spec and simple to generate correctly.
    Alphanumeric.sample_string(&mut rand::rng(), 64)
}

fn code_challenge_s256(verifier: &str) -> String {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    use sha2::{Digest, Sha256};

    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn generate_state() -> String {
    Alphanumeric.sample_string(&mut rand::rng(), 32)
}

// --- OAuth token exchange -----------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DropboxApiError {
    error_summary: String,
}

async fn handle_json_response<T: for<'de> Deserialize<'de>>(
    resp: reqwest::Response,
) -> Result<T, ProviderError> {
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| ProviderError::Network(e.to_string()))?;
    if !status.is_success() {
        let message = serde_json::from_str::<DropboxApiError>(&body)
            .map(|e| e.error_summary)
            .unwrap_or(body);
        return Err(ProviderError::Api(format!("{status}: {message}")));
    }
    serde_json::from_str(&body)
        .map_err(|e| ProviderError::Api(format!("unexpected response shape: {e}")))
}

/// Result of a successful [`connect`] call, for display in the UI ("Connected as ...").
pub struct DropboxAccountInfo {
    pub refresh_token: String,
    pub account_email: Option<String>,
}

/// Performs the full one-time "connect your Dropbox account" flow:
/// 1. Generate a PKCE verifier/challenge and CSRF `state`.
/// 2. Start a loopback HTTP listener on an OS-assigned free port and open the system browser to
///    Dropbox's authorize page with that port's redirect URI.
/// 3. Block (on a background thread) until Dropbox redirects back with `?code=...&state=...`,
///    verifying `state` matches to guard against a stray/forged callback.
/// 4. Exchange the authorization code for tokens (PKCE — no client secret involved).
/// 5. Fetch the account's email for display purposes.
///
/// Returns the refresh token (caller stores it in the OS keyring) and the account email. Never
/// stores anything itself — this module has no knowledge of the keyring or the database.
pub async fn connect(
    app_handle: &tauri::AppHandle,
    app_key: &str,
) -> Result<DropboxAccountInfo, ProviderError> {
    let verifier = generate_code_verifier();
    let challenge = code_challenge_s256(&verifier);
    let state = generate_state();

    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(ProviderError::Io)?;
    let port = listener.local_addr().map_err(ProviderError::Io)?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let auth_url = format!(
        "{DROPBOX_AUTHORIZE_URL}?client_id={}&response_type=code&code_challenge={}&code_challenge_method=S256&token_access_type=offline&redirect_uri={}&state={}",
        urlencoding_component(app_key),
        challenge,
        urlencoding_component(&redirect_uri),
        state,
    );

    open_in_browser(app_handle, &auth_url)?;

    let expected_state = state.clone();
    let code =
        tokio::task::spawn_blocking(move || wait_for_redirect_code(listener, &expected_state))
            .await
            .map_err(|e| {
                ProviderError::OAuthFlow(format!("sign-in listener task failed: {e}"))
            })??;

    let http = reqwest::Client::new();
    let token_resp: TokenResponse = handle_json_response(
        http.post(format!("{DEFAULT_API_BASE}/oauth2/token"))
            .form(&[
                ("code", code.as_str()),
                ("grant_type", "authorization_code"),
                ("client_id", app_key),
                ("code_verifier", verifier.as_str()),
                ("redirect_uri", redirect_uri.as_str()),
            ])
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?,
    )
    .await?;

    let refresh_token = token_resp
        .refresh_token
        .ok_or_else(|| ProviderError::OAuthFlow("Dropbox did not return a refresh token".into()))?;

    let account_email = fetch_account_email(&http, DEFAULT_API_BASE, &token_resp.access_token)
        .await
        .ok();

    Ok(DropboxAccountInfo {
        refresh_token,
        account_email,
    })
}

fn urlencoding_component(s: &str) -> String {
    // Minimal percent-encoding sufficient for the values we place in a query string here (an
    // App Key and a loopback redirect URI) — avoids pulling in a general-purpose URL-encoding
    // dependency for two small, well-understood inputs.
    let mut out = String::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn open_in_browser(app_handle: &tauri::AppHandle, url: &str) -> Result<(), ProviderError> {
    tauri_plugin_opener::OpenerExt::opener(app_handle)
        .open_url(url, None::<&str>)
        .map_err(|e| ProviderError::OAuthFlow(format!("could not open your browser: {e}")))
}

/// Blocks on a single incoming connection to `listener`, parses the redirect's `code`/`state`
/// query parameters out of the raw HTTP GET request line, and responds with a small HTML page
/// telling the user they can return to the app. No general-purpose HTTP server dependency is
/// needed for handling exactly one, well-known, browser-issued redirect request.
fn wait_for_redirect_code(
    listener: std::net::TcpListener,
    expected_state: &str,
) -> Result<String, ProviderError> {
    use std::io::{Read, Write};

    listener.set_nonblocking(false).map_err(ProviderError::Io)?;
    let (mut stream, _) = listener.accept().map_err(ProviderError::Io)?;
    stream
        .set_read_timeout(Some(Duration::from_secs(120)))
        .map_err(ProviderError::Io)?;

    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).map_err(ProviderError::Io)?;
    let request = String::from_utf8_lossy(&buf[..n]);

    let request_line = request
        .lines()
        .next()
        .ok_or_else(|| ProviderError::OAuthFlow("empty redirect request".into()))?;
    let path_and_query = request_line
        .strip_prefix("GET ")
        .and_then(|rest| rest.split(" HTTP/").next())
        .ok_or_else(|| {
            ProviderError::OAuthFlow(format!("unrecognized redirect request: {request_line}"))
        })?;

    let full_url = format!("http://127.0.0.1{path_and_query}");
    let parsed = reqwest::Url::parse(&full_url)
        .map_err(|e| ProviderError::OAuthFlow(format!("could not parse redirect URL: {e}")))?;

    let mut code = None;
    let mut state = None;
    let mut error = None;
    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "error_description" | "error" => error = Some(value.into_owned()),
            _ => {}
        }
    }

    let response_body = "<html><body><p>You can close this window and return to Pastry Management.</p></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        response_body.len(),
        response_body
    );
    let _ = stream.write_all(response.as_bytes());

    if let Some(message) = error {
        return Err(ProviderError::OAuthFlow(format!(
            "Dropbox declined: {message}"
        )));
    }

    let code = code.ok_or_else(|| {
        ProviderError::OAuthFlow("redirect was missing an authorization code".into())
    })?;
    match state {
        Some(s) if s == expected_state => Ok(code),
        _ => Err(ProviderError::OAuthFlow(
            "sign-in response failed a security check (state mismatch) — please try connecting again".into(),
        )),
    }
}

async fn fetch_account_email(
    http: &reqwest::Client,
    api_base: &str,
    access_token: &str,
) -> Result<String, ProviderError> {
    #[derive(Deserialize)]
    struct AccountResponse {
        email: String,
    }
    let resp = http
        .post(format!("{api_base}/2/users/get_current_account"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| ProviderError::Network(e.to_string()))?;
    let account: AccountResponse = handle_json_response(resp).await?;
    Ok(account.email)
}

// --- Provider implementation --------------------------------------------------------------------

pub struct DropboxProvider {
    app_key: String,
    refresh_token: String,
    http: reqwest::Client,
    api_base: String,
    content_base: String,
}

impl DropboxProvider {
    pub fn new(app_key: String, refresh_token: String) -> Self {
        Self {
            app_key,
            refresh_token,
            http: reqwest::Client::new(),
            api_base: DEFAULT_API_BASE.to_string(),
            content_base: DEFAULT_CONTENT_BASE.to_string(),
        }
    }

    /// Test-only constructor pointing at a mock server instead of the real Dropbox API, so the
    /// request/response handling below can be exercised in CI without live Dropbox credentials.
    #[cfg(test)]
    fn with_base_urls(
        app_key: String,
        refresh_token: String,
        api_base: String,
        content_base: String,
    ) -> Self {
        Self {
            app_key,
            refresh_token,
            http: reqwest::Client::new(),
            api_base,
            content_base,
        }
    }

    async fn access_token(&self) -> Result<String, ProviderError> {
        let resp = self
            .http
            .post(format!("{}/oauth2/token", self.api_base))
            .form(&[
                ("refresh_token", self.refresh_token.as_str()),
                ("grant_type", "refresh_token"),
                ("client_id", self.app_key.as_str()),
            ])
            .send()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;

        // A refresh-token exchange failing (as opposed to any other endpoint) specifically means
        // the stored token is invalid, expired, or was revoked from the Dropbox side — surfaced
        // distinctly so the UI can tell the user to reconnect, rather than showing a generic
        // "the provider rejected the request" for what's really an auth problem.
        if resp.status() == reqwest::StatusCode::BAD_REQUEST
            || resp.status() == reqwest::StatusCode::UNAUTHORIZED
        {
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::AuthFailed(body));
        }

        let token: TokenResponse = handle_json_response(resp).await?;
        Ok(token.access_token)
    }

    /// Retries a request up to [`MAX_RETRIES`] times on 429 (honoring `Retry-After` when present)
    /// or 5xx, with exponential backoff otherwise. Any other status is returned immediately.
    async fn send_with_retry<F, Fut>(
        &self,
        build_request: F,
    ) -> Result<reqwest::Response, ProviderError>
    where
        F: Fn() -> Fut,
        Fut: std::future::Future<Output = Result<reqwest::Response, reqwest::Error>>,
    {
        let mut attempt = 0;
        loop {
            let result = build_request().await;
            match result {
                Ok(resp) if resp.status().is_success() => return Ok(resp),
                Ok(resp) if attempt < MAX_RETRIES && should_retry(resp.status()) => {
                    let delay = retry_after(&resp).unwrap_or_else(|| backoff_delay(attempt));
                    attempt += 1;
                    tokio::time::sleep(delay).await;
                }
                Ok(resp) => return Ok(resp),
                Err(e) => return Err(ProviderError::Network(e.to_string())),
            }
        }
    }
}

fn should_retry(status: reqwest::StatusCode) -> bool {
    status.as_u16() == 429 || status.is_server_error()
}

fn retry_after(resp: &reqwest::Response) -> Option<Duration> {
    resp.headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .map(Duration::from_secs)
}

fn backoff_delay(attempt: u32) -> Duration {
    Duration::from_millis(500 * 2u64.pow(attempt))
}

#[derive(Debug, Deserialize)]
struct DropboxMetadata {
    name: String,
    path_display: Option<String>,
    id: Option<String>,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    server_modified: Option<String>,
}

impl From<DropboxMetadata> for RemoteBackupHandle {
    fn from(m: DropboxMetadata) -> Self {
        RemoteBackupHandle {
            id: m
                .path_display
                .or(m.id)
                .unwrap_or_else(|| format!("/{}", m.name)),
            name: m.name,
            size_bytes: m.size,
            modified_at: m.server_modified.unwrap_or_default(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct ListFolderResponse {
    entries: Vec<DropboxMetadata>,
}

#[async_trait::async_trait]
impl BackupStorageProvider for DropboxProvider {
    async fn test_connection(&self) -> Result<(), ProviderError> {
        self.access_token().await?;
        Ok(())
    }

    async fn upload(
        &self,
        local_path: &Path,
        remote_name: &str,
    ) -> Result<RemoteBackupHandle, ProviderError> {
        let token = self.access_token().await?;
        let bytes = tokio::fs::read(local_path)
            .await
            .map_err(ProviderError::Io)?;
        let dropbox_api_arg = serde_json::json!({
            "path": format!("/{remote_name}"),
            "mode": "add",
            "autorename": true,
            "mute": true,
        })
        .to_string();

        let resp = self
            .send_with_retry(|| {
                self.http
                    .post(format!("{}/2/files/upload", self.content_base))
                    .bearer_auth(&token)
                    .header("Dropbox-API-Arg", dropbox_api_arg.clone())
                    .header("Content-Type", "application/octet-stream")
                    .body(bytes.clone())
                    .send()
            })
            .await?;

        let meta: DropboxMetadata = handle_json_response(resp).await?;
        Ok(meta.into())
    }

    async fn list(&self) -> Result<Vec<RemoteBackupHandle>, ProviderError> {
        let token = self.access_token().await?;
        let resp = self
            .send_with_retry(|| {
                self.http
                    .post(format!("{}/2/files/list_folder", self.api_base))
                    .bearer_auth(&token)
                    .json(&serde_json::json!({ "path": "" }))
                    .send()
            })
            .await?;
        let parsed: ListFolderResponse = handle_json_response(resp).await?;
        Ok(parsed.entries.into_iter().map(Into::into).collect())
    }

    async fn download(
        &self,
        handle: &RemoteBackupHandle,
        dest: &Path,
    ) -> Result<(), ProviderError> {
        let token = self.access_token().await?;
        let dropbox_api_arg = serde_json::json!({ "path": handle.id }).to_string();

        let resp = self
            .send_with_retry(|| {
                self.http
                    .post(format!("{}/2/files/download", self.content_base))
                    .bearer_auth(&token)
                    .header("Dropbox-API-Arg", dropbox_api_arg.clone())
                    .send()
            })
            .await?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Api(body));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| ProviderError::Network(e.to_string()))?;
        tokio::fs::write(dest, &bytes)
            .await
            .map_err(ProviderError::Io)?;
        Ok(())
    }

    async fn delete(&self, handle: &RemoteBackupHandle) -> Result<(), ProviderError> {
        let token = self.access_token().await?;
        let resp = self
            .send_with_retry(|| {
                self.http
                    .post(format!("{}/2/files/delete_v2", self.api_base))
                    .bearer_auth(&token)
                    .json(&serde_json::json!({ "path": handle.id }))
                    .send()
            })
            .await?;
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::Api(body));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_verifier_is_within_pkce_length_bounds() {
        let verifier = generate_code_verifier();
        assert!(verifier.len() >= 43 && verifier.len() <= 128);
        assert!(verifier.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn code_challenge_is_deterministic_for_a_given_verifier() {
        // Known-good RFC 7636 appendix B test vector.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = code_challenge_s256(verifier);
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn should_retry_covers_429_and_5xx_but_not_4xx() {
        assert!(should_retry(reqwest::StatusCode::TOO_MANY_REQUESTS));
        assert!(should_retry(reqwest::StatusCode::INTERNAL_SERVER_ERROR));
        assert!(should_retry(reqwest::StatusCode::BAD_GATEWAY));
        assert!(!should_retry(reqwest::StatusCode::BAD_REQUEST));
        assert!(!should_retry(reqwest::StatusCode::UNAUTHORIZED));
        assert!(!should_retry(reqwest::StatusCode::NOT_FOUND));
    }

    #[test]
    fn backoff_delay_grows_exponentially() {
        assert_eq!(backoff_delay(0), Duration::from_millis(500));
        assert_eq!(backoff_delay(1), Duration::from_millis(1000));
        assert_eq!(backoff_delay(2), Duration::from_millis(2000));
    }

    async fn mock_provider(server: &mockito::ServerGuard) -> DropboxProvider {
        DropboxProvider::with_base_urls(
            "test-app-key".into(),
            "test-refresh-token".into(),
            server.url(),
            server.url(),
        )
    }

    fn mock_token_endpoint(server: &mut mockito::ServerGuard) -> mockito::Mock {
        server
            .mock("POST", "/oauth2/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                r#"{"access_token":"test-access-token","token_type":"bearer","expires_in":14400}"#,
            )
            .create()
    }

    #[tokio::test]
    async fn upload_sends_the_file_and_parses_the_returned_metadata() {
        let mut server = mockito::Server::new_async().await;
        let _token_mock = mock_token_endpoint(&mut server);
        let upload_mock = server
            .mock("POST", "/2/files/upload")
            .match_header("authorization", "Bearer test-access-token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"name":"backup-1.zip","path_display":"/backup-1.zip","id":"id:abc","size":1234,"server_modified":"2026-09-10T12:00:00Z"}"#)
            .create();

        let provider = mock_provider(&server).await;
        let tmp = std::env::temp_dir().join("dropbox_test_upload.zip");
        std::fs::write(&tmp, b"fake zip contents").unwrap();

        let handle = provider.upload(&tmp, "backup-1.zip").await.unwrap();

        upload_mock.assert();
        assert_eq!(handle.id, "/backup-1.zip");
        assert_eq!(handle.name, "backup-1.zip");
        assert_eq!(handle.size_bytes, 1234);

        let _ = std::fs::remove_file(&tmp);
    }

    #[tokio::test]
    async fn list_parses_multiple_entries() {
        let mut server = mockito::Server::new_async().await;
        let _token_mock = mock_token_endpoint(&mut server);
        let list_mock = server
            .mock("POST", "/2/files/list_folder")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                r#"{"entries":[
                    {"name":"backup-1.zip","path_display":"/backup-1.zip","size":100,"server_modified":"2026-09-01T00:00:00Z"},
                    {"name":"backup-2.zip","path_display":"/backup-2.zip","size":200,"server_modified":"2026-09-02T00:00:00Z"}
                ],"has_more":false,"cursor":"abc"}"#,
            )
            .create();

        let provider = mock_provider(&server).await;
        let entries = provider.list().await.unwrap();

        list_mock.assert();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "backup-1.zip");
        assert_eq!(entries[1].size_bytes, 200);
    }

    #[tokio::test]
    async fn download_writes_the_response_body_to_disk() {
        let mut server = mockito::Server::new_async().await;
        let _token_mock = mock_token_endpoint(&mut server);
        let download_mock = server
            .mock("POST", "/2/files/download")
            .with_status(200)
            .with_body("the backup archive bytes")
            .create();

        let provider = mock_provider(&server).await;
        let dest = std::env::temp_dir().join("dropbox_test_download.zip");
        let handle = RemoteBackupHandle {
            id: "/backup-1.zip".into(),
            name: "backup-1.zip".into(),
            size_bytes: 0,
            modified_at: String::new(),
        };

        provider.download(&handle, &dest).await.unwrap();

        download_mock.assert();
        assert_eq!(
            std::fs::read_to_string(&dest).unwrap(),
            "the backup archive bytes"
        );
        let _ = std::fs::remove_file(&dest);
    }

    #[tokio::test]
    async fn delete_sends_the_correct_path() {
        let mut server = mockito::Server::new_async().await;
        let _token_mock = mock_token_endpoint(&mut server);
        let delete_mock = server
            .mock("POST", "/2/files/delete_v2")
            .match_body(mockito::Matcher::Json(
                serde_json::json!({ "path": "/backup-1.zip" }),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"metadata":{"name":"backup-1.zip"}}"#)
            .create();

        let provider = mock_provider(&server).await;
        let handle = RemoteBackupHandle {
            id: "/backup-1.zip".into(),
            name: "backup-1.zip".into(),
            size_bytes: 0,
            modified_at: String::new(),
        };

        provider.delete(&handle).await.unwrap();
        delete_mock.assert();
    }

    #[tokio::test]
    async fn api_error_response_is_surfaced_with_its_message() {
        let mut server = mockito::Server::new_async().await;
        let _token_mock = mock_token_endpoint(&mut server);
        server
            .mock("POST", "/2/files/list_folder")
            .with_status(409)
            .with_header("content-type", "application/json")
            .with_body(r#"{"error_summary":"path/not_found/","error":{}}"#)
            .create();

        let provider = mock_provider(&server).await;
        let err = provider.list().await.unwrap_err();
        assert!(matches!(err, ProviderError::Api(_)));
        assert!(err.to_string().contains("path/not_found"));
    }

    #[tokio::test]
    async fn expired_refresh_token_is_reported_as_an_auth_failure_not_a_generic_api_error() {
        let mut server = mockito::Server::new_async().await;
        server
            .mock("POST", "/oauth2/token")
            .with_status(401)
            .with_body(r#"{"error_summary":"invalid_grant/","error":{}}"#)
            .create();

        let provider = mock_provider(&server).await;
        let err = provider.list().await.unwrap_err();
        assert!(
            matches!(err, ProviderError::AuthFailed(_)),
            "expected AuthFailed, got {err:?}"
        );
    }

    #[tokio::test]
    async fn transient_server_error_is_retried_and_then_succeeds() {
        let mut server = mockito::Server::new_async().await;
        let _token_mock = mock_token_endpoint(&mut server);
        let _first_attempt = server
            .mock("POST", "/2/files/list_folder")
            .with_status(503)
            .expect(1)
            .create();
        let _second_attempt = server
            .mock("POST", "/2/files/list_folder")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"entries":[],"has_more":false,"cursor":"x"}"#)
            .expect(1)
            .create();

        let provider = mock_provider(&server).await;
        let entries = provider.list().await.unwrap();
        assert_eq!(entries.len(), 0);
    }
}
