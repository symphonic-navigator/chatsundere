// SPDX-License-Identifier: AGPL-3.0-only

// Blocks ALL external network (no phone-home / IP-leak / tracking from previewed
// HTML); allows only inline style/script and data: images/fonts.
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;">`;
const SCROLLBAR =
  '<style>*::-webkit-scrollbar{width:8px;height:8px}*::-webkit-scrollbar-thumb{background:rgba(141,109,255,.3);border-radius:4px}*{scrollbar-width:thin;scrollbar-color:rgba(141,109,255,.3) transparent}</style>';
// Bridge Escape inside the iframe out to the lightbox.
const ESCAPE = `<script>window.addEventListener('keydown',function(e){if(e.key==='Escape')window.parent.postMessage({type:'lightbox-escape'},'*')})</script>`;

/** Renders an HTML file in a hard-sandboxed iframe: allow-scripts WITHOUT
 *  allow-same-origin, so it runs at a null origin and cannot read cookies,
 *  localStorage or IndexedDB (where the MasterKey / ciphertext live). A strict
 *  CSP blocks every external request. */
export function HtmlPreview({ content }: { content: string }): JSX.Element {
  const head = `${CSP}${SCROLLBAR}${ESCAPE}`;
  const srcDoc = content.includes('</head>')
    ? content.replace('</head>', `${head}</head>`)
    : `${head}${content}`;
  return (
    <iframe
      className="lightbox-html"
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      title="HTML preview"
    />
  );
}
