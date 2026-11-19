// Files in this folder are bundled as plain text (see tsup.config.ts).
declare module "*.html" {
  const text: string;
  export default text;
}
declare module "*.css" {
  const text: string;
  export default text;
}
