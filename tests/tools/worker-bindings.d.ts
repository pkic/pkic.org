/** Native publication tooling imports Env without replacing Node and DOM globals. */
type R2Bucket = import("@cloudflare/workers-types").R2Bucket;
type WorkerLoader = import("@cloudflare/workers-types").WorkerLoader;
type KVNamespace = import("@cloudflare/workers-types").KVNamespace;
type DurableObjectNamespace<T extends Rpc.DurableObjectBranded | undefined = undefined> =
  import("@cloudflare/workers-types").DurableObjectNamespace<T>;
declare namespace Rpc {
  type DurableObjectBranded = import("@cloudflare/workers-types").Rpc.DurableObjectBranded;
}
