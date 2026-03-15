/**
 * Express type declarations
 * 
 * Provides minimal type definitions for Express when @types/express
 * is not available or fails to install.
 */

declare module "express" {
  import { Server } from "http";
  
  export interface Request {
    body: unknown;
    params: Record<string, string>;
    query: Record<string, string | string[] | undefined>;
    headers: Record<string, string | string[] | undefined>;
    method: string;
    url: string;
    path: string;
  }
  
  export interface Response {
    status(code: number): Response;
    json(body: unknown): Response;
    send(body: unknown): Response;
    end(): Response;
    set(field: string, value: string): Response;
    type(type: string): Response;
  }
  
  export interface NextFunction {
    (err?: unknown): void;
  }
  
  export type RequestHandler = (
    req: Request,
    res: Response,
    next: NextFunction
  ) => void | Promise<void>;
  
  export interface Application {
    use(handler: RequestHandler): Application;
    use(path: string, handler: RequestHandler): Application;
    use(path: string, ...handlers: RequestHandler[]): Application;
    get(path: string, handler: RequestHandler): Application;
    post(path: string, handler: RequestHandler): Application;
    put(path: string, handler: RequestHandler): Application;
    delete(path: string, handler: RequestHandler): Application;
    listen(port: number, callback?: () => void): Server;
  }
  
  export interface Express extends Application {
    (): Application;
    json(options?: { limit?: string | number }): RequestHandler;
    urlencoded(options?: { extended?: boolean }): RequestHandler;
    static(root: string): RequestHandler;
  }
  
  const express: Express;
  export default express;
}

declare module "inngest/express" {
  import type { RequestHandler } from "express";
  import type { Inngest, InngestFunction } from "inngest";
  
  export interface ServeOptions {
    client: Inngest;
    functions: InngestFunction[];
  }
  
  export function serve(options: ServeOptions): RequestHandler;
}
