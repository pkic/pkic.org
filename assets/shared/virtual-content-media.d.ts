declare module "virtual:pkic-content-media" {
  export const webinarSponsors: Readonly<Record<string, { name: string; logoSrc?: string }>>;
  const paths: readonly string[];
  export default paths;
}
