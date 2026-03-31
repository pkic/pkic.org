export type RouteHandler = (context: any) => Promise<Response>;

export interface RouteModule {
  onRequest?: RouteHandler;
  onRequestGet?: RouteHandler;
  onRequestPost?: RouteHandler;
  onRequestPut?: RouteHandler;
  onRequestPatch?: RouteHandler;
  onRequestDelete?: RouteHandler;
  onRequestHead?: RouteHandler;
  onRequestOptions?: RouteHandler;
}
