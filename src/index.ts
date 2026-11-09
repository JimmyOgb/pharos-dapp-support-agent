export type * from './types.ts';
export * from './config.ts';
export * from './mcp-client.ts';
export * from './decoder.ts';
export * from './explanation.ts';
export * from './diagnostics.ts';

export default function handler(req: any, res: any) {
  if (res.redirect) {
    res.redirect('/');
  } else {
    res.writeHead(302, { Location: '/' });
    res.end();
  }
}

