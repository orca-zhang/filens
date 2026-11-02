/// <reference types="vite/client" />

declare module '*?archive-url' {
  const resolveUrl: () => string;
  export default resolveUrl;
}
