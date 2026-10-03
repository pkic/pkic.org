declare module "virtual:pkic-trust-list" {
  import type { TrustListPublisher } from "./schemas/trust-lists";

  const publishers: TrustListPublisher[];
  export default publishers;
}
