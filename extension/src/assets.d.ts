// SVG files are bundled as text (esbuild `loader: { '.svg': 'text' }`) and inlined, so the logo
// renders inside closed shadow roots on pages whose CSP blocks data: or extension image URLs.
declare module '*.svg' {
  const markup: string;
  export default markup;
}
