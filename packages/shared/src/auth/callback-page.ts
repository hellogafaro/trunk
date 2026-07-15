/**
 * OAuth callback page HTML generation.
 * This module is browser-safe (no Node.js dependencies) so it can be used
 * in both the callback server and the playground preview.
 */

export type AppType = 'terminal' | 'electron';

/**
 * Generate a minimal, clean callback page matching the app's design system.
 * Logo at top, status message in a card below.
 */
export function generateCallbackPage(options: {
  title: string;
  isSuccess: boolean;
  errorDetail?: string;
  appType?: AppType;
  deeplinkUrl?: string;
}): string {
  const { title, isSuccess, errorDetail, deeplinkUrl } = options;

  // Status message based on success/error
  const statusMessage = isSuccess
    ? 'Authorization successful'
    : errorDetail
      ? `Authorization failed: ${errorDetail}`
      : 'Authorization failed';

  // Generate deeplink redirect and auto-close for success
  const autoCloseScript = isSuccess
    ? `
    setTimeout(() => {
      ${deeplinkUrl ? `window.location.href = '${deeplinkUrl}';` : ''}
      window.close();
    }, 1500);`
    : '';


  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trunk - ${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      width: 100vw;
      height: 100vh;
      /* bg-foreground-2: 2% foreground mixed with background */
      background-color: #f7f7f7;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .logo {
      width: 48px;
      height: 48px;
      color: #0c0a09;
      margin-bottom: 48px;
    }

    .content {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .card {
      max-width: 480px;
      border-radius: 8px;
      padding: 16px 24px;
      text-align: center;
      /* Tinted background and shadow based on state */
      ${isSuccess
        ? `/* Success state - green tinted */
      background-color: rgba(34, 120, 60, 0.03);
      box-shadow:
        rgba(34, 120, 60, 0.12) 0px 0px 0px 1px,
        rgba(34, 120, 60, 0.08) 0px 1px 1px -0.5px,
        rgba(34, 120, 60, 0.06) 0px 3px 3px -1.5px,
        rgba(34, 120, 60, 0.04) 0px 6px 6px -3px;`
        : `/* Error state - red tinted */
      background-color: rgba(180, 60, 50, 0.03);
      box-shadow:
        rgba(180, 60, 50, 0.12) 0px 0px 0px 1px,
        rgba(180, 60, 50, 0.08) 0px 1px 1px -0.5px,
        rgba(180, 60, 50, 0.06) 0px 3px 3px -1.5px,
        rgba(180, 60, 50, 0.04) 0px 6px 6px -3px;`
      }
    }

    .status {
      font-size: 14px;
      font-weight: 400;
      /* Text color mixed 50% with foreground for readability */
      color: ${isSuccess ? '#2d6b47' : '#a14040'};
    }

    .hint {
      margin-top: 24px;
      font-size: 13px;
      color: rgba(0, 0, 0, 0.4);
    }

    .return-link {
      display: inline-block;
      margin-top: 16px;
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 500;
      color: #fff;
      background-color: oklch(54.6% 0.245 262.881);
      border-radius: 6px;
      text-decoration: none;
      transition: background-color 0.15s ease;
    }

    .return-link:hover {
      background-color: oklch(48.8% 0.243 264.376);
    }

    @media (prefers-color-scheme: dark) {
      body {
        background-color: #1a1a1a;
      }
      .logo {
        color: #f5f5f4;
      }
      .card {
        ${isSuccess
          ? `/* Success state dark - green tinted */
        background-color: rgba(50, 140, 80, 0.03);
        box-shadow:
          rgba(50, 140, 80, 0.12) 0px 0px 0px 1px,
          rgba(50, 140, 80, 0.08) 0px 1px 1px -0.5px,
          rgba(50, 140, 80, 0.06) 0px 3px 3px -1.5px,
          rgba(50, 140, 80, 0.04) 0px 6px 6px -3px;`
          : `/* Error state dark - red tinted */
        background-color: rgba(200, 80, 70, 0.03);
        box-shadow:
          rgba(200, 80, 70, 0.12) 0px 0px 0px 1px,
          rgba(200, 80, 70, 0.08) 0px 1px 1px -0.5px,
          rgba(200, 80, 70, 0.06) 0px 3px 3px -1.5px,
          rgba(200, 80, 70, 0.04) 0px 6px 6px -3px;`
        }
      }
      .status {
        /* Brighter text colors in dark mode */
        color: ${isSuccess ? '#6bc489' : '#e88080'};
      }
      .hint {
        color: rgba(255, 255, 255, 0.4);
      }
    }
  </style>
</head>
<body>
  <div class="content">
    <svg class="logo" viewBox="0 0 880 880" aria-label="Trunk" fill="currentColor">
      <path d="M279.679 44.566c-39.268 24.617-74.157 46.405-77.689 48.669C182.498 105.543 34.607 198.071 26.838 202.74c-5.085 2.971-13.137 8.064-18.08 11.176L0 219.576l.283 110.495.423 110.495 30.652 19.241c141.111 88 143.512 89.556 144.359 94.084.566 2.263.848 51.923.707 110.353l-.141 106.11 25.849 16.411C282.928 837.698 350.87 880 352.141 880c1.413 0 17.092-9.762 166.254-103.28 67.942-42.585 206.51-129.312 226.003-141.479 21.612-13.44 51.133-31.974 60.456-37.916 5.226-3.254 11.724-7.216 14.408-8.772 2.683-1.556 17.374-10.752 32.488-20.231l27.544-17.402.424-110.496L880 329.929l-9.464-6.083c-5.367-3.254-12.713-8.065-16.668-10.47C811.352 286.212 353.13 0 352.141 0c-.706 0-33.335 20.09-72.462 44.566Zm-83.48 77.672c8.899 5.518 22.742 14.148 30.793 19.241 8.051 5.093 25.143 15.846 38.138 23.91 13.136 8.064 26.979 16.695 30.793 19.241 3.955 2.547 10.311 6.508 14.125 8.913 79.666 49.943 175.576 110.071 197.047 123.37 15.114 9.479 44.494 27.73 65.258 40.746 20.764 13.016 58.761 36.643 84.328 52.63l46.613 29.004.141 110.07c0 87.717-.424 109.93-1.695 109.081-2.26-1.274-55.936-34.663-121.053-75.409-27.544-17.26-50.568-31.267-51.274-31.267-.565 0-1.13 49.094-1.13 108.939v109.081l-3.108-1.698c-3.108-1.556-37.997-23.344-128.257-79.794l-43.082-27.023-.423-110.353-.283-110.354-67.518-42.302c-37.008-23.203-76.7-48.103-88.142-55.036l-20.764-12.874-.141-110.071c0-87.717.424-109.929 1.836-109.08.848.565 8.899 5.517 17.798 11.035Z"></path>
    </svg>
    <div class="card">
      <div class="status">${statusMessage}</div>
    </div>
    <div class="hint">${isSuccess ? 'You can now return to the application.' : 'Please close this window and try again.'}</div>
    ${deeplinkUrl ? `<a href="${deeplinkUrl}" class="return-link">Trunk</a>` : ''}
  </div>
  <script>${autoCloseScript}</script>
</body>
</html>`;
}
