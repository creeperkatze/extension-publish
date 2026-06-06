# Extension Publish

A GitHub Action to upload and publish browser extensions to the Chrome Web Store, Firefox Add-ons, and Edge Add-ons.

![GitHub Issues](https://img.shields.io/github/issues/creeperkatze/extension-publish?labelColor=0d143c)
![GitHub Pull Requests](https://img.shields.io/github/issues-pr/creeperkatze/extension-publish?labelColor=0d143c)
![GitHub Repo stars](https://img.shields.io/github/stars/creeperkatze/extension-publish?style=flat&labelColor=0d143c)

## 🚀 Usage

```yaml
- uses: creeperkatze/extension-publish@v1
  with:
    # Chrome Web Store
    chrome-client-id:     ${{ secrets.CHROME_CLIENT_ID }}
    chrome-client-secret: ${{ secrets.CHROME_CLIENT_SECRET }}
    chrome-refresh-token: ${{ secrets.CHROME_REFRESH_TOKEN }}
    chrome-publisher-id:  ${{ secrets.CHROME_PUBLISHER_ID }}
    chrome-extension-id:  ${{ secrets.CHROME_EXTENSION_ID }}
    chrome-zip-path:      ./extension.zip

    # Firefox Add-ons
    firefox-api-key:      ${{ secrets.FIREFOX_API_KEY }}
    firefox-api-secret:   ${{ secrets.FIREFOX_API_SECRET }}
    firefox-extension-id: ${{ secrets.FIREFOX_EXTENSION_ID }}
    firefox-xpi-path:     ./extension.zip
    firefox-license:      mpl-2.0

    # Edge Add-ons
    edge-api-key:         ${{ secrets.EDGE_API_KEY }}
    edge-client-id:       ${{ secrets.EDGE_CLIENT_ID }}
    edge-product-id:      ${{ secrets.EDGE_PRODUCT_ID }}
    edge-zip-path:        ./extension.zip
```

All stores are optional, only the stores with provided inputs will run.

## ⚙️ Store Setup

### Chrome Web Store

1. Go to the [Google Cloud Console](https://console.cloud.google.com) and create or open a project.
2. Enable the **Chrome Web Store API** under APIs & Services.
3. Go to **APIs & Services > Credentials**, create an **OAuth 2.0 Client ID** (type: Web application), and add `https://developers.google.com/oauthplayground` as an authorized redirect URI.
4. Note the **Client ID** and **Client Secret**.
5. Open [OAuth Playground](https://developers.google.com/oauthplayground), click the settings gear, enable **Use your own OAuth credentials**, and enter your Client ID and Secret.
6. In Step 1, enter the scope `https://www.googleapis.com/auth/chromewebstore` and authorize.
7. In Step 2, exchange the authorization code for tokens, note the **Refresh Token**.
8. Open the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole), go to **Publisher > Settings** to find your **Publisher ID**, and open your extension to find its **Extension ID**.

| Secret | Where to find it |
|---|---|
| `CHROME_CLIENT_ID` | Google Cloud Console > Credentials |
| `CHROME_CLIENT_SECRET` | Google Cloud Console > Credentials |
| `CHROME_REFRESH_TOKEN` | OAuth Playground Step 2 |
| `CHROME_PUBLISHER_ID` | Chrome Developer Dashboard > Publisher > Settings |
| `CHROME_EXTENSION_ID` | Chrome Developer Dashboard > your extension's page |

---

### Firefox Add-ons

1. Sign in to [addons.mozilla.org](https://addons.mozilla.org).
2. Go to [API Credentials](https://addons.mozilla.org/developers/addon/api/key/).
3. Click **Generate new credentials** - note the **JWT issuer** (API key) and **JWT secret** (API secret).
4. Your **Extension ID** is the add-on ID, slug, or GUID shown in the add-on's developer page (e.g. `{your-addon@example.com}`).

| Secret | Where to find it |
|---|---|
| `FIREFOX_API_KEY` | AMO > API Credentials > JWT issuer |
| `FIREFOX_API_SECRET` | AMO > API Credentials > JWT secret |
| `FIREFOX_EXTENSION_ID` | AMO > your add-on > developer page |

---

### Edge Add-ons

1. Sign in to [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge).
2. Under **Microsoft Edge**, select **Publish API**.
3. Click **Create API credentials** - note the **Client ID** and **API Key**.
4. To find your **Product ID**, open your extension in Partner Center and copy the GUID from the URL or the **Extension identity** section.

| Secret | Where to find it |
|---|---|
| `EDGE_API_KEY` | Partner Center > Publish API |
| `EDGE_CLIENT_ID` | Partner Center > Publish API |
| `EDGE_PRODUCT_ID` | Partner Center > your extension > Extension identity |

## 📥 Inputs

### Chrome Web Store

| Input | Required | Default | Description |
|---|---|---|---|
| `chrome-client-id` | Yes | - | OAuth2 client ID |
| `chrome-client-secret` | Yes | - | OAuth2 client secret |
| `chrome-refresh-token` | Yes | - | Long-lived refresh token |
| `chrome-publisher-id` | Yes | - | Publisher ID from the developer dashboard |
| `chrome-extension-id` | Yes | - | Extension item ID |
| `chrome-zip-path` | Yes | - | Path to the `.zip` to upload |
| `chrome-publish` | No | `true` | Set to `false` to upload without publishing |
| `chrome-publish-type` | No | `DEFAULT_PUBLISH` | `DEFAULT_PUBLISH` or `STAGED_PUBLISH` |
| `chrome-deploy-percentage` | No | - | Rollout percentage for `STAGED_PUBLISH` (0–100) |
| `chrome-skip-review` | No | `false` | Attempt to bypass review if eligible |

### Firefox Add-ons

| Input | Required | Default | Description |
|---|---|---|---|
| `firefox-api-key` | Yes | - | AMO JWT issuer (API key) |
| `firefox-api-secret` | Yes | - | AMO JWT secret |
| `firefox-extension-id` | Yes | - | Add-on ID, slug, or GUID |
| `firefox-xpi-path` | Yes | - | Path to the `.xpi` or `.zip` to upload |
| `firefox-channel` | No | `listed` | `listed` or `unlisted` |
| `firefox-license` | No | - | License slug (e.g. `mpl-2.0`, `mit`) |
| `firefox-approval-notes` | No | - | Internal notes for Mozilla reviewers |
| `firefox-release-notes` | No | - | Release notes (plain string or `{"en-US":"..."}` JSON) |
| `firefox-compatibility-firefox` | No | - | Firefox desktop compatibility: `true` (all versions), `109.0` (min only), or `109.0, 120.0` (min, max) |
| `firefox-compatibility-android` | No | - | Firefox for Android compatibility: `true` (all versions), `113.0` (min only), or `113.0, 120.0` (min, max) |

### Edge Add-ons

| Input | Required | Default | Description |
|---|---|---|---|
| `edge-api-key` | Yes | - | API key from Partner Center |
| `edge-client-id` | Yes | - | Client ID from Partner Center |
| `edge-product-id` | Yes | - | Product ID GUID |
| `edge-zip-path` | Yes | - | Path to the `.zip` to upload |
| `edge-publish` | No | `true` | Set to `false` to upload without publishing |
| `edge-notes` | No | - | Certification notes for Microsoft reviewers |

## 📤 Outputs

| Output | Store | Description |
|---|---|---|
| `chrome-upload-state` | Chrome | Upload state (`SUCCESS`, `FAILURE`, `IN_PROGRESS`, …) |
| `chrome-crx-version` | Chrome | Version from the uploaded manifest |
| `chrome-publish-state` | Chrome | Submission state after publish |
| `chrome-item-id` | Chrome | Extension item ID echoed from the API |
| `firefox-upload-uuid` | Firefox | UUID of the uploaded file |
| `firefox-version-id` | Firefox | Numeric ID of the new version |
| `firefox-version-state` | Firefox | Review state of the new version |
| `edge-upload-operation-id` | Edge | Operation ID from the upload step |
| `edge-upload-status` | Edge | Upload status (`Succeeded`, `Failed`, `InProgress`) |
| `edge-publish-operation-id` | Edge | Operation ID from the publish step |
| `edge-publish-status` | Edge | Publish status (`Succeeded`, `Failed`, `InProgress`) |

## 📜 License

AGPL-3.0
