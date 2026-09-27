import { z } from 'zod';

const port = z.coerce.number().int().min(1024).max(65535);
export const demoPort = port.parse(process.env.DEMO_PORT ?? 3000);
export const demoApiPort = port.parse(process.env.DEMO_API_PORT ?? 4000);
if (demoPort === demoApiPort) throw new Error('Demo dashboard and API ports must differ');
